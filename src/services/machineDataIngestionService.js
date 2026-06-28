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

const horizons = ["15m", "30m", "45m", "1h"];
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
  console.log('[Alert] createActualAlerts fired — status:', machine.status, '| thresholds:', JSON.stringify(machine.thresholds))
  if (!machine.thresholds || machine.status === "PENDING") {
    console.warn('[Alert] Skipping — no thresholds set or machine is PENDING')
    return;
  }

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
      if (exists) {
  console.log("[Alert] Alert already exists. Sending email again.");

  exists.value = c.value;
  exists.timestamp = new Date();
  exists.message = `${c.param} exceeded critical`;

  await exists.save();

  await sendAlertEmailToUsers(exists, machine).catch((err) => {
    console.error("Failed to send email", err);
  });

} else {

  console.log("[Alert] Creating new HIGH alert");

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
    console.error("Failed to send email", err);
  });
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
      if (exists) {

  console.log("[Alert] MEDIUM alert already exists. Sending email again.");

  exists.value = c.value;
  exists.timestamp = new Date();
  exists.message = `${c.param} exceeded warning`;

  await exists.save();

  await sendAlertEmailToUsers(exists, machine).catch((err) => {
    console.error("Failed to send email", err);
  });

} else {

  console.log("[Alert] Creating new MEDIUM alert");

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
    console.error("Failed to send email", err);
  });

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

  const minsMap = { "15m": 15, "30m": 30, "45m": 45, "1h": 60 };
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

      if (exists) {

  console.log("[Alert] Predicted HIGH alert already exists. Sending email again.");

  exists.value = c.value;
  exists.timestamp = new Date();
  exists.message = `${base} (critical)`;

  await exists.save();

  await sendAlertEmailToUsers(exists, machine).catch((err) => {
    console.error("Failed to send email", err);
  });

} else {

  console.log("[Alert] Creating new predicted HIGH alert");

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
    console.error("Failed to send email", err);
  });

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

      if (exists) {

  console.log("[Alert] Predicted MEDIUM alert already exists. Sending email again.");

  exists.value = c.value;
  exists.timestamp = new Date();
  exists.message = `${base} (warning)`;

  await exists.save();

  await sendAlertEmailToUsers(exists, machine).catch((err) => {
    console.error("Failed to send email", err);
  });

} else {

  console.log("[Alert] Creating new predicted MEDIUM alert");

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
    console.error("Failed to send email", err);
  });

}
    }
  }
};

const generatePredictions = async (machine) => {
  console.log(`[ML Pipeline] Starting prediction generation for machine: ${machine.machineName || machine._id}`);
  const results = []
  if (machine.status === 'PENDING') return results
  
  const [temperatureValues, currentValues, vibrationValues] = await Promise.all([
    getLatestSignalValues(machine._id, "temperature"),
    getLatestSignalValues(machine._id, "current"),
    getLatestSignalValues(machine._id, "vibration"),
  ]);

  const tempCount = temperatureValues ? temperatureValues.length : 0;
  const currCount = currentValues ? currentValues.length : 0;
  const vibCount = vibrationValues ? vibrationValues.length : 0;

  console.log(`[ML Pipeline] Historical readings - Temp: ${tempCount}, Curr: ${currCount}, Vib: ${vibCount}`);
  console.log(`[ML Pipeline] getLatestSignalValues() returns 61 values? Temp: ${tempCount === 61}, Curr: ${currCount === 61}, Vib: ${vibCount === 61}`);

  const latestTemperature = temperatureValues?.[temperatureValues.length - 1] ?? 0;
  const latestCurrent = currentValues?.[currentValues.length - 1] ?? 0;
  const latestVibration = vibrationValues?.[vibrationValues.length - 1] ?? 0;

  // Try running ML predictions
  let mlTemperature = null;
  let mlCurrent = null;
  let mlVibration = null;

  const canRunMl = temperatureValues && temperatureValues.length >= 61 &&
                   currentValues && currentValues.length >= 61 &&
                   vibrationValues && vibrationValues.length >= 61;

  console.log(`[ML Pipeline] Whether runMlPrediction() is called: ${!!canRunMl}`);

  if (canRunMl) {
    console.log(`[ML Pipeline] Calling predictTemperature(), predictCurrent(), and predictVibration()`);
    [mlTemperature, mlCurrent, mlVibration] = await Promise.all([
      runMlPrediction("temperature", temperatureValues, predictTemperature),
      runMlPrediction("current", currentValues, predictCurrent),
      runMlPrediction("vibration", vibrationValues, predictVibration),
    ]);
  }

  let tempForecast = [];
  let currForecast = [];
  let vibForecast = [];
  let confidence = DEFAULT_ML_CONFIDENCE;
  let predictionSource = ML_PREDICTION_SOURCE;
  let modelName = ML_MODEL_NAME;
  let modelVersion = ML_MODEL_VERSION;

  const hasMlData = mlTemperature && Array.isArray(mlTemperature.forecast) && mlTemperature.forecast.length > 0 &&
                    mlCurrent && Array.isArray(mlCurrent.forecast) && mlCurrent.forecast.length > 0 &&
                    mlVibration && Array.isArray(mlVibration.forecast) && mlVibration.forecast.length > 0;

  console.log(`[ML Pipeline] hasMlData evaluation: ${hasMlData}`);
  if (!hasMlData) {
    console.log(`[ML Pipeline] Failing conditions for hasMlData:`, {
      mlTemperatureValid: !!(mlTemperature && Array.isArray(mlTemperature.forecast) && mlTemperature.forecast.length > 0),
      mlCurrentValid: !!(mlCurrent && Array.isArray(mlCurrent.forecast) && mlCurrent.forecast.length > 0),
      mlVibrationValid: !!(mlVibration && Array.isArray(mlVibration.forecast) && mlVibration.forecast.length > 0)
    });
  }

  if (hasMlData) {
    tempForecast = mlTemperature.forecast.map(v => Math.max(0, Math.min(120, Number(v) < 0 ? latestTemperature : Number(v))));
    currForecast = mlCurrent.forecast.map(v => Math.max(0, Math.min(100, Number(v) < 0 ? latestCurrent : Number(v))));
    vibForecast = mlVibration.forecast.map(v => Math.max(0, Math.min(20, Number(v) < 0 ? latestVibration : Number(v))));
    confidence = mlTemperature.confidence ?? DEFAULT_ML_CONFIDENCE;
  } else {
    // FALLBACK generator to produce exactly 24 points at 2.5 min intervals using simple forecast
    console.log("ML prediction failed or insufficient history. Using consistent fallback generator.");
    predictionSource = "FORECAST_SERVICE";
    modelName = "Regression/MA";
    modelVersion = "ma_linear_v1";
    confidence = 0.7;

    const recentTemp = temperatureValues || [0];
    const recentCurr = currentValues || [0];
    const recentVib = vibrationValues || [0];

    const tempAvg = recentTemp.reduce((sum, v) => sum + v, 0) / recentTemp.length;
    const currAvg = recentCurr.reduce((sum, v) => sum + v, 0) / recentCurr.length;
    const vibAvg = recentVib.reduce((sum, v) => sum + v, 0) / recentVib.length;

    const firstTemp = recentTemp[0] ?? 0;
    const lastTemp = recentTemp[recentTemp.length - 1] ?? 0;
    const firstCurr = recentCurr[0] ?? 0;
    const lastCurr = recentCurr[recentCurr.length - 1] ?? 0;
    const firstVib = recentVib[0] ?? 0;
    const lastVib = recentVib[recentVib.length - 1] ?? 0;

    const minutesSpan = recentTemp.length > 1 ? recentTemp.length * 5 : 5;

    for (let i = 1; i <= 24; i++) {
      const minutes = i * 2.5;
      
      const pTemp = tempAvg + ((lastTemp - firstTemp) / minutesSpan) * minutes;
      const pCurr = currAvg + ((lastCurr - firstCurr) / minutesSpan) * minutes;
      const pVib = vibAvg + ((lastVib - firstVib) / minutesSpan) * minutes;

      const valTemp = Math.max(0, Math.min(120, Math.round((pTemp + (Math.random() - 0.5) * tempAvg * 0.01) * 10) / 10));
      const valCurr = Math.max(0, Math.min(100, Math.round((pCurr + (Math.random() - 0.5) * currAvg * 0.01) * 10) / 10));
      const valVib = Math.max(0, Math.min(20, Math.round((pVib + (Math.random() - 0.5) * vibAvg * 0.01) * 10) / 10));

      tempForecast.push(valTemp);
      currForecast.push(valCurr);
      vibForecast.push(valVib);
    }
  }

  // Define index mapping for horizons: 15m (index 5), 30m (index 11), 45m (index 17), 1h (index 23)
  const targetHorizons = ["15m", "30m", "45m", "1h"];
  const horizonIndices = {
    "15m": 5,
    "30m": 11,
    "45m": 17,
    "1h": 23
  };

  for (const targetHorizon of targetHorizons) {
    const idx = horizonIndices[targetHorizon];
    
    const slicedTempForecast = tempForecast.slice(0, idx + 1);
    const slicedCurrForecast = currForecast.slice(0, idx + 1);
    const slicedVibForecast = vibForecast.slice(0, idx + 1);

    const predictionDoc = new Prediction({
      machineId: machine._id,
      horizon: targetHorizon,
      temperature: slicedTempForecast[idx],
      current: slicedCurrForecast[idx],
      vibration: slicedVibForecast[idx],
      confidence: Math.round(confidence * 100) / 100,
      forecastValues: slicedTempForecast,
      temperatureForecastValues: slicedTempForecast,
      currentForecastValues: slicedCurrForecast,
      vibrationForecastValues: slicedVibForecast,
      modelName,
      modelVersion,
      predictionSource,
      temperatureModelName: modelName,
      temperatureModelVersion: modelVersion,
      temperaturePredictionSource: predictionSource,
      currentModelName: modelName,
      currentModelVersion: modelVersion,
      currentPredictionSource: predictionSource,
      vibrationModelName: modelName,
      vibrationModelVersion: modelVersion,
      vibrationPredictionSource: predictionSource,
      createdAt: new Date()
    });

    await predictionDoc.save();
    results.push({ horizon: targetHorizon, prediction: predictionDoc });

    try {
      await createPredictedAlerts(machine, predictionDoc, targetHorizon);
    } catch (err) {
      console.error('Error creating predicted alerts', err);
    }
  }

  return results;
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