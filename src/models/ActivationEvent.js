import mongoose from 'mongoose'

const ActivationEventSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  hardwareId: { type: String },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  machineName: { type: String },
  location: { type: String },
  thresholds: {
    temperature: {
      warning: Number,
      critical: Number
    },
    vibration: {
      warning: Number,
      critical: Number
    },
    current: {
      warning: Number,
      critical: Number
    }
  },
  statusBefore: { type: String },
  statusAfter: { type: String },
  timestamp: { type: Date, default: Date.now }
})

export default mongoose.model('ActivationEvent', ActivationEventSchema)
