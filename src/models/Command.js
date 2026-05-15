import mongoose from 'mongoose'

const CommandSchema = new mongoose.Schema({
  machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  commandType: { type: String, enum: ['STOP_MACHINE','REDUCE_SPEED','START_MACHINE'], required: true },
  payload: { type: Object },
  status: { type: String, enum: ['PENDING','EXECUTED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now },
  executedAt: { type: Date }
})

export default mongoose.model('Command', CommandSchema)
