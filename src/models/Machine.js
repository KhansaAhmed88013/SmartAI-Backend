import mongoose from 'mongoose'

const ThresholdSchema = new mongoose.Schema({
  warning: { type: Number, required: true },
  critical: { type: Number, required: true }
}, { _id: false })

const MachineSchema = new mongoose.Schema({
  // Hardware identifier from microcontroller, must be unique
  hardwareId: { type: String, required: true, unique: true },

  // Name can be assigned upon activation; placeholder on registration
  machineName: { type: String, required: true },
  location: { type: String },

  // Include PENDING for newly registered machines
  status: { type: String, enum: ['PENDING', 'RUNNING', 'STOPPED', 'WARNING'], default: 'PENDING' },
  speed: { type: Number, default: 1000 },

  // Thresholds are optional until activation
  thresholds: {
    temperature: { type: ThresholdSchema, required: false },
    vibration: { type: ThresholdSchema, required: false },
    current: { type: ThresholdSchema, required: false }
  },

  // Audit fields for activation
  activatedAt: { type: Date },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Machine', MachineSchema)
