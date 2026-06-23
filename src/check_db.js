import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const MachineSchema = new mongoose.Schema({
  hardwareId: String,
  machineName: String,
  status: String,
  lastSensorAt: Date
});

const SensorDataSchema = new mongoose.Schema({
  machineId: mongoose.Schema.Types.ObjectId,
  temperature: Number,
  vibration: Number,
  current: Number,
  timestamp: Date
});

const Machine = mongoose.model('Machine', MachineSchema);
const SensorData = mongoose.model('SensorData', SensorDataSchema, 'sensordatas');

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB!");
    
    const count = await SensorData.countDocuments({});
    console.log(`Total SensorData documents: ${count}`);

    const latestData = await SensorData.find({}).sort({ timestamp: -1 }).limit(5);
    console.log("Latest SensorData entries:");
    for (const d of latestData) {
      console.log(`- Machine ID: ${d.machineId}, Temp: ${d.temperature}, Vib: ${d.vibration}, Curr: ${d.current}, Time: ${d.timestamp}`);
    }

    const machines = await Machine.find({});
    console.log("\nMachines:");
    for (const m of machines) {
      console.log(`- ID: ${m._id}, Name: ${m.machineName}, Status: ${m.status}, lastSensorAt: ${m.lastSensorAt}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
