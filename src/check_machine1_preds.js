import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Prediction from './models/Prediction.js';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB!");

    const machineId = new mongoose.Types.ObjectId("6a07be5b369659f65d93dbce");
    const count = await Prediction.countDocuments({ machineId });
    console.log(`Total predictions for Machine 1: ${count}`);

    const latest = await Prediction.find({ machineId }).sort({ createdAt: -1 }).limit(5);
    for (const p of latest) {
      console.log(`Horizon: ${p.horizon}, Source: ${p.predictionSource}, Model: ${p.modelName}, Temp: ${p.temperature}, Created: ${p.createdAt}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
