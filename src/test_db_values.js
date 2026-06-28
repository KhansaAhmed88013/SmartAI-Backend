import mongoose from "mongoose";
import dotenv from "dotenv";
import Machine from "./models/Machine.js";
import SensorData from "./models/SensorData.js";

dotenv.config();

const getLatestSignalValues = async (machineId, field) => {
  const rows = await SensorData.find({ machineId })
    .sort({ timestamp: -1 })
    .limit(61)
    .select(`${field} timestamp`)
    .lean();

  console.log(`For field ${field}, found ${rows.length} rows`);
  if (rows.length < 61) return null;

  return rows.reverse().map((row) => Number(row[field]));
};

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const machines = await Machine.find({});
  for (const m of machines) {
    console.log(`Machine: ${m.machineName} (${m._id}), Status: ${m.status}`);
    const temp = await getLatestSignalValues(m._id, "temperature");
    const curr = await getLatestSignalValues(m._id, "current");
    const vib = await getLatestSignalValues(m._id, "vibration");
    console.log(`Temp values length: ${temp ? temp.length : 'null'}`);
    console.log(`Curr values length: ${curr ? curr.length : 'null'}`);
    console.log(`Vib values length: ${vib ? vib.length : 'null'}`);
  }

  await mongoose.disconnect();
}

test();
