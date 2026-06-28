import { predictTemperature, predictCurrent, predictVibration } from "./services/mlPredictionClient.js";
import dotenv from "dotenv";

dotenv.config();

async function test() {
  const dummyValues = Array(61).fill(1.0);
  try {
    console.log("Testing predictTemperature...");
    const tempRes = await predictTemperature(dummyValues);
    console.log("Temp response:", tempRes);
  } catch (err) {
    console.error("Temp error:", err);
  }

  try {
    console.log("Testing predictCurrent...");
    const currRes = await predictCurrent(dummyValues);
    console.log("Curr response:", currRes);
  } catch (err) {
    console.error("Curr error:", err);
  }

  try {
    console.log("Testing predictVibration...");
    const vibRes = await predictVibration(dummyValues);
    console.log("Vib response:", vibRes);
  } catch (err) {
    console.error("Vib error:", err);
  }
}

test();
