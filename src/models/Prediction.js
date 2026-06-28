import mongoose from 'mongoose'

const PredictionSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  horizon: { type: String, enum: ['15m','30m','45m','1h'], required: true },
  temperature: { type: Number },
  vibration: { type: Number },
  current: { type: Number },
  confidence: { type: Number },
  forecastValues: { type: [Number] },
  temperatureForecastValues: { type: [Number] },
  currentForecastValues: { type: [Number] },
  vibrationForecastValues: { type: [Number] },
  modelName: { type: String },
  modelVersion: { type: String },
  predictionSource: { type: String },
  temperatureModelName: { type: String },
  temperatureModelVersion: { type: String },
  temperaturePredictionSource: { type: String },
  currentModelName: { type: String },
  currentModelVersion: { type: String },
  currentPredictionSource: { type: String },
  vibrationModelName: { type: String },
  vibrationModelVersion: { type: String },
  vibrationPredictionSource: { type: String },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Prediction', PredictionSchema)
