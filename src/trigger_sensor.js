import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Machine from './models/Machine.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const machine = await Machine.findOne({ machineName: "Machine 1" });
  if (!machine) {
    console.log("Machine 1 not found");
    await mongoose.disconnect();
    return;
  }
  console.log(`Machine 1 hardwareId: ${machine.hardwareId}`);
  await mongoose.disconnect();

  const payload = {
    hardwareId: machine.hardwareId,
    temperature: 30.5,
    vibration: 0.85,
    current: 0.45,
    timestamp: new Date().toISOString()
  };

  console.log("Sending payload:", payload);
  try {
    const res = await fetch("http://localhost:4000/api/sensor-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("Response status:", res.status);
    const json = await res.json();
    console.log("Response body:", json);
  } catch (err) {
    console.error("Error sending POST:", err);
  }
}

run();
