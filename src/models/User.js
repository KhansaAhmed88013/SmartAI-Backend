import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  // Canonical roles: SYSTEM_ADMIN, MAINTENANCE_ENGINEER, MACHINE_OPERATOR
  // Legacy aliases retained for backward compatibility: ADMIN, OPERATOR
  role: {
  type: String,
  enum: [
    'SYSTEM_ADMIN',
    'MACHINE_OPERATOR',
    'ADMIN',
    'OPERATOR'
  ],
  default: 'MACHINE_OPERATOR'
},
notifications: {
    sms: { type: Boolean, default: false },
    email: { type: Boolean, default: true }
  },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('User', UserSchema)
