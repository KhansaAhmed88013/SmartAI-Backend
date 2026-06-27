import Machine from "../models/Machine.js";
import SensorData from "../models/SensorData.js";
import Alert from "../models/Alert.js";
import Prediction from "../models/Prediction.js";
import { ForecastService } from "./forecastService.js";
import { sendAlertEmailToUsers } from "./emailService.js";
import {
  predictTemperature,
  predictCurrent,
  predictVibration,
} from "./mlPredictionClient.js";

const horizons = ["15m", "1h", "6h", "24h"];
const ML_FORECAST_HORIZON = "1h";
const DEFAULT_ML_CONFIDENCE = 0.8;
const ML_MODEL_NAME = "Autoformer";
const ML_MODEL_VERSION = "multi_signal_autoformer_v1";
const ML_PREDICTION_SOURCE = "ML_SERVICE";
const SIGNAL_MODEL_CONFIG = {
  temperature: {
    field: "temperature",
    valuesField: "temperatureForecastValues",
    modelVersion: "temperature_autoformer_v1",
    predictor: predictTemperature,
  },
  current: {
    field: "current",
    valuesField: "currentForecastValues",
    modelVersion: "current_autoformer_v1",
    predictor: predictCurrent,
  },
  vibration: {
    field: "vibration",
    valuesField: "vibrationForecastValues",
    modelVersion: "vibration_autoformer_v1",
    predictor: predictVibration,
  },
};

const VIBRATION_HISTORY_LIMIT = 12;
const VIBRATION_MEDIAN_WINDOW = 5;
const VIBRATION_ZERO_EPSILON = 0.02;
const VIBRATION_EWMA_ALPHA = 0.35;
const VIBRATION_SPIKE_Z_THRESHOLD = 3.5;
const VIBRATION_MAX_RELATIVE_JUMP = 0.45;
const MIN_HISTORY_FOR_SPIKE_CHECK = 3;

const validatePayload = (payload) => {
  const keys = ["temperature", "vibration", "current"];
  for (const k of keys) {
    const val = payload?.[k];
    if (typeof val !== "number" || Number.isNaN(val)) {
      throw new Error(`Invalid sensor payload: ${k} must be a number`);
    }
  }
};

const mean = (arr) => {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
};

const median = (arr) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getRecentVibrations = async (machineId) => {
  const docs = await SensorData.find({ machineId })
    .sort({ timestamp: -1 })
    .limit(VIBRATION_HISTORY_LIMIT)
    .lean();

  return docs
    .map((d) => Number(d.vibration))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .reverse();
};


const getLatestSignalValues = async (machineId, field) => {
  const rows = await SensorData.find({ machineId })
    .sort({ timestamp: -1 })
    .limit(61)
    .select(`${field} timestamp`)
    .lean();

  if (rows.length < 61) return null;

  return rows.reverse().map((row) => Number(row[field]));
};

const runMlPrediction = async (signalName, values, predictor) => {
  if (!Array.isArray(values) || values.length < 61) {
    return null;
  }

  try {
    const response = await predictor(values);

    if (!response || !Array.isArray(response.forecast) || response.forecast.length === 0) {
      return null;
    }

    return {
      forecast: response.forecast,
      confidence:
        typeof response.confidence === "number" && Number.isFinite(response.confidence)
          ? response.confidence
          : DEFAULT_ML_CONFIDENCE,
    };
  } catch (err) {
    console.error(`Error getting ML ${signalName} forecast`, err);
    return null;
  }
};

const applySignalForecast = (
  prediction,
  signalName,
  forecast,
  confidence,
  latestValue
) => {
  if (!forecast || !Array.isArray(forecast.forecast) || forecast.forecast.length === 0) {
    return false;
  }

  const config = SIGNAL_MODEL_CONFIG[signalName];
  if (!config) return false;

  const cleanedForecast = forecast.forecast.map(value => {
    const num = Number(value);
    if (num < 0) {
      return latestValue;
    }
    return num;
  });

prediction[config.field] = cleanedForecast[0];
prediction[config.valuesField] = cleanedForecast;
  prediction[`${signalName}ModelName`] = ML_MODEL_NAME;
  prediction[`${signalName}ModelVersion`] = config.modelVersion;
  prediction[`${signalName}PredictionSource`] = ML_PREDICTION_SOURCE;
  prediction.confidence = confidence;

  return true;
};

const smoothVibrationReading = async (machineId, rawVibration) => {
  const history = await getRecentVibrations(machineId);
  const recentWindow = history.slice(-VIBRATION_MEDIAN_WINDOW);

  const validHistory = history.filter((v) => v > VIBRATION_ZERO_EPSILON);
  const baseline = recentWindow.length
    ? median(recentWindow)
    : validHistory.length
      ? mean(validHistory)
      : rawVibration;

  if (!Number.isFinite(rawVibration)) {
    return {
      rawVibration,
      cleanedVibration: baseline,
      method: "invalid-fallback",
    };
  }

  // Replace 0 / near-zero drops with a stable local baseline
  if (rawVibration <= VIBRATION_ZERO_EPSILON) {
    return {
      rawVibration,
      cleanedVibration: baseline,
      method: "zero-filled",
    };
  }

  // When there is not enough history, use gentle smoothing only
  if (history.length < MIN_HISTORY_FOR_SPIKE_CHECK) {
    const last = history.length ? history[history.length - 1] : rawVibration;
    const cleaned = history.length
      ? VIBRATION_EWMA_ALPHA * rawVibration + (1 - VIBRATION_EWMA_ALPHA) * last
      : rawVibration;

    return {
      rawVibration,
      cleanedVibration: Number(cleaned.toFixed(4)),
      method: history.length ? "ewma-warmup" : "raw",
    };
  }

  const med = recentWindow.length ? median(recentWindow) : median(history);
  const deviations = (recentWindow.length ? recentWindow : history).map((v) =>
    Math.abs(v - med),
  );
  const mad = median(deviations) || 1e-6;

  const lastValid = history[history.length - 1];
  const robustZ = Math.abs(rawVibration - med) / (1.4826 * mad);
  const relativeJump =
    Math.abs(rawVibration - lastValid) / (Math.abs(lastValid) + 1e-6);

  let cleanedVibration = rawVibration;

  // Strong spike or sudden drop: pull it toward the local median
  if (
    robustZ > VIBRATION_SPIKE_Z_THRESHOLD ||
    relativeJump > VIBRATION_MAX_RELATIVE_JUMP
  ) {
    cleanedVibration = 0.7 * med + 0.3 * rawVibration;
  } else {
    // Normal variation: smooth it with EWMA
    cleanedVibration =
      VIBRATION_EWMA_ALPHA * rawVibration +
      (1 - VIBRATION_EWMA_ALPHA) * lastValid;
  }

  return {
    rawVibration,
    cleanedVibration: Number(
      clamp(cleanedVibration, 0, Number.MAX_SAFE_INTEGER).toFixed(4),
    ),
    method: "smoothed",
  };
};

const createActualAlerts = async (machine, sensorDoc) => {
  if (!machine.thresholds || machine.status === "PENDING") return;

  const checks = [
    {
      param: "temperature",
      value: sensorDoc.temperature,
      thresh: machine.thresholds.temperature,
    },
    {
      param: "vibration",
      value: sensorDoc.vibration,
      thresh: machine.thresholds.vibration,
    },
    {
      param: "current",
      value: sensorDoc.current,
      thresh: machine.thresholds.current,
    },
  ];

  let hasThresholdViolation = false;

  for (const c of checks) {
    if (!c.thresh) continue;

    if (c.value >= c.thresh.critical) {
      hasThresholdViolation = true;
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: "ACTUAL",
        severity: "HIGH",
        resolved: false,
        threshold: c.thresh.critical,
      });
      if (!exists) {
        const alertDoc = await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.critical,
          severity: "HIGH",
          source: "ACTUAL",
          message: `${c.param} exceeded critical`,
          timestamp: new Date(),
        }).save();
        await sendAlertEmailToUsers(alertDoc, machine).catch((err) => {
          console.error('Failed to send alert email for actual HIGH alert', err)
        })
      }
    } else if (c.value >= c.thresh.warning) {
      hasThresholdViolation = true;
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: "ACTUAL",
        severity: "MEDIUM",
        resolved: false,
        threshold: c.thresh.warning,
      });
      if (!exists) {
        const alertDoc = await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.warning,
          severity: "MEDIUM",
          source: "ACTUAL",
          message: `${c.param} exceeded warning`,
          timestamp: new Date(),
        }).save();
        await sendAlertEmailToUsers(alertDoc, machine).catch((err) => {
          console.error('Failed to send alert email for actual MEDIUM alert', err)
        })
      }
    }
  }

  if (hasThresholdViolation && machine.status !== 'WARNING') {
    machine.status = 'WARNING'
    await machine.save()
  } else if (!hasThresholdViolation && machine.status === 'WARNING') {
    machine.status = 'RUNNING'
    await machine.save()
  }
};

const createPredictedAlerts = async (machine, prediction, horizonKey) => {
  if (!machine.thresholds) return;

  const minsMap = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 };
  const mins = minsMap[horizonKey] || 60;

  const checks = [
    {
      param: "temperature",
      value: prediction.temperature,
      thresh: machine.thresholds.temperature,
    },
    {
      param: "vibration",
      value: prediction.vibration,
      thresh: machine.thresholds.vibration,
    },
    {
      param: "current",
      value: prediction.current,
      thresh: machine.thresholds.current,
    },
  ];

  for (const c of checks) {
    if (!c.thresh) continue;

    const base = `${c.param} predicted to exceed threshold in ~${mins} minutes (horizon ${horizonKey})`;

    if (c.value >= c.thresh.critical) {
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: "PREDICTED",
        severity: "HIGH",
        resolved: false,
        threshold: c.thresh.critical,
      });

      if (!exists) {
        const alertDoc = await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.critical,
          severity: "HIGH",
          source: "PREDICTED",
          message: `${base} (critical)`,
          timestamp: new Date(),
        }).save();
        await sendAlertEmailToUsers(alertDoc, machine).catch((err) => {
          console.error('Failed to send alert email for predicted HIGH alert', err)
        })
      }
    } else if (c.value >= c.thresh.warning) {
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: "PREDICTED",
        severity: "MEDIUM",
        resolved: false,
        threshold: c.thresh.warning,
      });

      if (!exists) {
        const alertDoc = await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.warning,
          severity: "MEDIUM",
          source: "PREDICTED",
          message: `${base} (warning)`,
          timestamp: new Date(),
        }).save();
        await sendAlertEmailToUsers(alertDoc, machine).catch((err) => {
          console.error('Failed to send alert email for predicted MEDIUM alert', err)
        })
      }
    }
  }
};

const generatePredictions = async (machine) => {
  console.log('About to generate predictions for machine:', machine._id.toString())
  const results = []
  if (machine.status === 'PENDING') return results

  const [temperatureValues, currentValues, vibrationValues] = await Promise.all([
    getLatestSignalValues(machine._id, "temperature"),
    getLatestSignalValues(machine._id, "current"),
    getLatestSignalValues(machine._id, "vibration"),
  ])

  const latestTemperature = temperatureValues?.[temperatureValues.length - 1];
  const latestCurrent = currentValues?.[currentValues.length - 1];
  const latestVibration = vibrationValues?.[vibrationValues.length - 1];

  console.log("Temperature values found:", temperatureValues ? temperatureValues.length : 0)
  console.log("Current values found:", currentValues ? currentValues.length : 0)
  console.log("Vibration values found:", vibrationValues ? vibrationValues.length : 0)

  const [mlTemperature, mlCurrent, mlVibration] = await Promise.all([
    runMlPrediction("temperature", temperatureValues, predictTemperature),
    runMlPrediction("current", currentValues, predictCurrent),
    runMlPrediction("vibration", vibrationValues, predictVibration),
  ])

  for (const horizon of horizons) {
    const basePrediction = await ForecastService.generatePrediction(
      machine._id,
      horizon
    )

    if (basePrediction) {
      const prediction = { ...basePrediction }

      // ── Global negative-value guard (applies to ALL horizons) ──
      // Never show negative predictions — replace with last real sensor reading
      if (typeof prediction.temperature === "number" && prediction.temperature < 0) {
        prediction.temperature = latestTemperature;
      }
      if (typeof prediction.current === "number" && prediction.current < 0) {
        prediction.current = latestCurrent;
      }
      if (typeof prediction.vibration === "number" && prediction.vibration < 0) {
        prediction.vibration = latestVibration;
      }
      if (Array.isArray(prediction.forecastValues)) {
        prediction.forecastValues = prediction.forecastValues.map(v => (Number(v) < 0 ? latestTemperature : Number(v)));
      }
      if (Array.isArray(prediction.temperatureForecastValues)) {
        prediction.temperatureForecastValues = prediction.temperatureForecastValues.map(v => (Number(v) < 0 ? latestTemperature : Number(v)));
      }
      if (Array.isArray(prediction.currentForecastValues)) {
        prediction.currentForecastValues = prediction.currentForecastValues.map(v => (Number(v) < 0 ? latestCurrent : Number(v)));
      }
      if (Array.isArray(prediction.vibrationForecastValues)) {
        prediction.vibrationForecastValues = prediction.vibrationForecastValues.map(v => (Number(v) < 0 ? latestVibration : Number(v)));
      }
      // ────────────────────────────────────────────────────────────

      if (
        horizon === ML_FORECAST_HORIZON &&
        (mlTemperature || mlCurrent || mlVibration)
      ) {
        const primaryForecast = mlTemperature || mlCurrent || mlVibration

        prediction.modelName = ML_MODEL_NAME
        prediction.modelVersion = ML_MODEL_VERSION
        prediction.predictionSource = ML_PREDICTION_SOURCE
        prediction.confidence = DEFAULT_ML_CONFIDENCE

        if (mlTemperature) {
          applySignalForecast(
            prediction,
            "temperature",
            mlTemperature,
            mlTemperature.confidence,
            latestTemperature
          )
          prediction.forecastValues = mlTemperature.forecast
        }

        if (mlCurrent) {
          applySignalForecast(
            prediction,
            "current",
            mlCurrent,
            mlCurrent.confidence,
            latestCurrent
          )
        }

        if (mlVibration) {
          applySignalForecast(
            prediction,
            "vibration",
            mlVibration,
            mlVibration.confidence,
            latestVibration
          )
        }

        if (!prediction.forecastValues && primaryForecast) {
          prediction.forecastValues = primaryForecast.forecast
        }

        try {
          if (typeof basePrediction.save === 'function') {
            basePrediction.temperature = prediction.temperature
            basePrediction.current = prediction.current
            basePrediction.vibration = prediction.vibration
            basePrediction.forecastValues = prediction.forecastValues
            basePrediction.temperatureForecastValues = prediction.temperatureForecastValues
            basePrediction.currentForecastValues = prediction.currentForecastValues
            basePrediction.vibrationForecastValues = prediction.vibrationForecastValues
            basePrediction.confidence = prediction.confidence
            basePrediction.modelName = prediction.modelName
            basePrediction.modelVersion = prediction.modelVersion
            basePrediction.predictionSource = prediction.predictionSource
            basePrediction.temperatureModelName = prediction.temperatureModelName
            basePrediction.temperatureModelVersion = prediction.temperatureModelVersion
            basePrediction.temperaturePredictionSource = prediction.temperaturePredictionSource
            basePrediction.currentModelName = prediction.currentModelName
            basePrediction.currentModelVersion = prediction.currentModelVersion
            basePrediction.currentPredictionSource = prediction.currentPredictionSource
            basePrediction.vibrationModelName = prediction.vibrationModelName
            basePrediction.vibrationModelVersion = prediction.vibrationModelVersion
            basePrediction.vibrationPredictionSource = prediction.vibrationPredictionSource
            await basePrediction.save()
          } else {
            await Prediction.findByIdAndUpdate(basePrediction._id, {
              temperature: prediction.temperature,
              current: prediction.current,
              vibration: prediction.vibration,
              forecastValues: prediction.forecastValues,
              temperatureForecastValues: prediction.temperatureForecastValues,
              currentForecastValues: prediction.currentForecastValues,
              vibrationForecastValues: prediction.vibrationForecastValues,
              confidence: prediction.confidence,
              modelName: prediction.modelName,
              modelVersion: prediction.modelVersion,
              predictionSource: prediction.predictionSource,
              temperatureModelName: prediction.temperatureModelName,
              temperatureModelVersion: prediction.temperatureModelVersion,
              temperaturePredictionSource: prediction.temperaturePredictionSource,
              currentModelName: prediction.currentModelName,
              currentModelVersion: prediction.currentModelVersion,
              currentPredictionSource: prediction.currentPredictionSource,
              vibrationModelName: prediction.vibrationModelName,
              vibrationModelVersion: prediction.vibrationModelVersion,
              vibrationPredictionSource: prediction.vibrationPredictionSource,
            })
          }
        } catch (err) {
          console.error('Error saving ML temperature prediction', err)
        }
      }

      results.push({ horizon, prediction })

      try {
        await createPredictedAlerts(machine, prediction, horizon)
      } catch (err) {
        console.error('Error creating predicted alerts', err)
      }
    }
  }

  return results
}

export class MachineDataIngestionService {
  static async receiveSensorData(machineId, payload) {
    console.log("receiveSensorData reached for machine:", machineId);
    validatePayload(payload);

    const machine = await Machine.findById(machineId);
    if (!machine) throw new Error("Machine not found");

    const timestamp = payload.timestamp
      ? new Date(payload.timestamp)
      : new Date();
    const vibrationResult = await smoothVibrationReading(
      machineId,
      payload.vibration,
    );

    const sensorDoc = new SensorData({
      machineId,
      temperature: payload.temperature,
      rawVibration: vibrationResult.rawVibration,
      vibration: vibrationResult.cleanedVibration,
      current: payload.current,
      timestamp,
    });

    await sensorDoc.save();

    machine.lastSensorAt = new Date()

if (machine.status !== 'RUNNING' && machine.status !== 'PENDING') {
  machine.status = 'RUNNING'
}

await machine.save()

const verifyMachine = await Machine.findById(machine._id)

console.log("STATUS DEBUG")
console.log({
  status: verifyMachine.status,
  lastSensorAt: verifyMachine.lastSensorAt
})

    console.log(
      `SensorData received for machine ${machine.machineName || machine.hardwareId || machine._id}: temp=${sensorDoc.temperature}, vib=${sensorDoc.rawVibration}, curr=${sensorDoc.current}, source=${machine.hardwareId || machine._id}`,
    );

    await createActualAlerts(machine, sensorDoc);
    await generatePredictions(machine);

    return sensorDoc;
  }
}

export const receiveSensorData = (machineId, payload) =>
  MachineDataIngestionService.receiveSensorData(machineId, payload);