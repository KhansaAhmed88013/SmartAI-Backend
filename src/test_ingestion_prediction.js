import mongoose from "mongoose";
import dotenv from "dotenv";
import Machine from "./models/Machine.js";
import { predictTemperature, predictCurrent, predictVibration } from "./services/mlPredictionClient.js";

dotenv.config();

// We'll import the actual functions or write a small test harness that mimics generatePredictions
import SensorData from "./models/SensorData.js";

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
    console.log(`[Test] ${signalName} values not array or length < 61`);
    return null;
  }

  try {
    const response = await predictor(values);
    console.log(`[Test] Raw response for ${signalName}:`, JSON.stringify(response));

    if (!response || !Array.isArray(response.forecast) || response.forecast.length === 0) {
      console.log(`[Test] ${signalName} response forecast is not array or empty`);
      return null;
    }

    return {
      forecast: response.forecast,
      confidence:
        typeof response.confidence === "number" && Number.isFinite(response.confidence)
          ? response.confidence
          : 0.8,
    };
  } catch (err) {
    console.error(`[Test] Error getting ML ${signalName} forecast:`, err);
    return null;
  }
};

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const machine = await Machine.findOne({ machineName: "Machine 1" });
  if (!machine) {
    console.log("Machine 1 not found");
    await mongoose.disconnect();
    return;
  }

  console.log("Found machine:", machine._id);

  const [temperatureValues, currentValues, vibrationValues] = await Promise.all([
    getLatestSignalValues(machine._id, "temperature"),
    getLatestSignalValues(machine._id, "current"),
    getLatestSignalValues(machine._id, "vibration"),
  ]);

  console.log("Temp history length:", temperatureValues ? temperatureValues.length : "null");
  console.log("Curr history length:", currentValues ? currentValues.length : "null");
  console.log("Vib history length:", vibrationValues ? vibrationValues.length : "null");

  const [mlTemperature, mlCurrent, mlVibration] = await Promise.all([
    runMlPrediction("temperature", temperatureValues, predictTemperature),
    runMlPrediction("current", currentValues, predictCurrent),
    runMlPrediction("vibration", vibrationValues, predictVibration),
  ]);

  console.log("mlTemperature:", mlTemperature);
  console.log("mlCurrent:", mlCurrent);
  console.log("mlVibration:", mlVibration);

  const hasMlData = mlTemperature && Array.isArray(mlTemperature.forecast) && mlTemperature.forecast.length > 0 &&
                    mlCurrent && Array.isArray(mlCurrent.forecast) && mlCurrent.forecast.length > 0 &&
                    mlVibration && Array.isArray(mlVibration.forecast) && mlVibration.forecast.length > 0;

  console.log("hasMlData evaluates to:", hasMlData);

  await mongoose.disconnect();
}

test();
