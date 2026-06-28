import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Prediction from './models/Prediction.js';

dotenv.config({ path: './.env' });

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB!");

    const horizons = ['15m', '30m', '45m', '1h'];
    for (const h of horizons) {
      const latest = await Prediction.findOne({ horizon: h }).sort({ createdAt: -1 });
      if (latest) {
        console.log(`Horizon: ${h}`);
        console.log(`- Created At: ${latest.createdAt}`);
        console.log(`- Temp: ${latest.temperature}, Vib: ${latest.vibration}, Curr: ${latest.current}`);
        console.log(`- Prediction Source: ${latest.predictionSource}`);
        console.log(`- Confidence: ${latest.confidence}`);
        console.log(`- Temp Forecast length: ${latest.temperatureForecastValues?.length}`);
      } else {
        console.log(`Horizon: ${h} - No predictions found.`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
