const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";

const callMlEndpoint = async (path, values) => {
  const response = await fetch(`${ML_SERVICE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML service error: ${response.status} ${text}`);
  }
  const result = await response.json();
  console.log("ML Prediction Result:", result);
  return result;
};

export const predictTemperature = async (values) => callMlEndpoint("/predict/temperature", values);

export const predictCurrent = async (values) => callMlEndpoint("/predict/current", values);

export const predictVibration = async (values) => callMlEndpoint("/predict/vibration", values);
