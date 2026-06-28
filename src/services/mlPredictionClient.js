const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";

const callMlEndpoint = async (path, values) => {
  const url = `${ML_SERVICE_URL}${path}`;
  console.log(`[ML Pipeline] Calling ML endpoint: ${url}`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });

    console.log(`[ML Pipeline] HTTP response code for ${path}: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`[ML Pipeline] HTTP error body for ${path}: ${text}`);
      throw new Error(`ML service error: ${response.status} ${text}`);
    }
    const result = await response.json();
    console.log(`[ML Pipeline] Response body for ${path}:`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(`[ML Pipeline] Exception during call to ${url}:`, err.message || err);
    throw err;
  }
};

export const predictTemperature = async (values) => callMlEndpoint("/predict/temperature", values);

export const predictCurrent = async (values) => callMlEndpoint("/predict/current", values);

export const predictVibration = async (values) => callMlEndpoint("/predict/vibration", values);
