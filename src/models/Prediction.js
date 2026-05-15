import mongoose from 'mongoose'

const PredictionSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  horizon: { type: String, enum: ['15m','1h','6h','24h'], required: true },
  temperature: { type: Number },
  vibration: { type: Number },
  current: { type: Number },
  confidence: { type: Number },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Prediction', PredictionSchema)
