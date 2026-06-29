import cron from "node-cron";
import { spawn } from "child_process";
import path from "path";

export function startRetrainCron() {
    //cron.schedule("*/10 * * * *", ...) for every 10 minutes
    //cron.schedule("0 3 * * 0", ...) for every Sunday at 3 AM
    
  cron.schedule("/3 * * * *", () => {
    console.log("Starting daily model retraining...");

    const scriptPath = path.join(
      process.cwd(),
      "src",
      "ml-service",
      "retrain",
      "retrain_all.py"
    );

    const pythonPath = path.join(
      process.cwd(),
      "src",
      "ml-service",
      ".venv",
      "Scripts",
      "python.exe"
    );

    const processRun = spawn(
      pythonPath,
      [scriptPath]
    );

    processRun.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    processRun.stderr.on("data", (data) => {
      console.error(data.toString());
    });

    processRun.on("close", (code) => {
      console.log(`Retraining finished with code ${code}`);
    });
  });

  console.log("Retraining cron started.");
}