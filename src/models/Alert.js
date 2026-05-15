import mongoose from 'mongoose'

const AlertSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  parameter: { type: String, enum: ['temperature','vibration','current'], required: true },
  value: { type: Number, required: true },
  threshold: { type: Number, required: true },
  severity: { type: String, enum: ['LOW','MEDIUM','HIGH'], required: true },
  source: { type: String, enum: ['ACTUAL','PREDICTED'], required: true },
  message: { type: String },
  resolved: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
})

export default mongoose.model('Alert', AlertSchema)
