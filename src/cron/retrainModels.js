  // cron.schedule("0 3 * * 0", ...) for every Sunday at 3 AM
import cron from "node-cron";

let retrainingRunning = false;

export function startRetrainCron() {

  cron.schedule("*/10 * * * *", async () => {

    if (retrainingRunning) {
      console.log("[CRON] Retraining already running. Skipping this cycle.");
      return;
    }

    retrainingRunning = true;

    console.log("\n[CRON]\nRetraining started");

    const url = `${process.env.ML_SERVICE_URL || "http://127.0.0.1:8001"}/retrain`;

    try {

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log(`\n[BACKEND]\nHTTP status: ${response.status}`);

      const data = await response.json();

      if (response.ok && data.success) {
        console.log("Returned JSON:", JSON.stringify(data, null, 2));
        console.log(`Duration: ${data.durationSeconds} seconds`);
        console.log("Retraining successful");
      } else {
        console.error("Retraining failed:", data);
      }

    } catch (err) {

      console.error("Error calling retrain endpoint:", err.message || err);

    } finally {

      retrainingRunning = false;
      console.log("[CRON] Retraining lock released.");

    }

  });

  console.log("Retraining cron started.");

}