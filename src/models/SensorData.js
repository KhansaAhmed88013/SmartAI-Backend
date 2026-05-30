import mongoose from 'mongoose'

const SensorSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },

  temperature: { type: Number, required: true },

  rawVibration: { type: Number, required: true },
  vibration: { type: Number, required: true },

  current: { type: Number, required: true },

  timestamp: { type: Date, default: Date.now }
})

export default mongoose.model('SensorData', SensorSchema)