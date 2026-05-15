import User from '../models/User.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

class AuthServiceImpl {
  static async login(email, password, roleOverride = null) {
    const user = await User.findOne({ email })
    if (!user) throw new Error('Invalid credentials')
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) throw new Error('Invalid credentials')

    const demoEnv = process.env.DEMO ? String(process.env.DEMO).toLowerCase().replace(/['"]/g, '') : ''
    const finalRole = (demoEnv === 'true' && roleOverride) ? roleOverride : user.role

    const token = jwt.sign({ id: user._id, role: finalRole, name: user.name }, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' })
    return { token, user: { id: user._id, name: user.name, email: user.email, role: finalRole } }
  }

  static async getProfile(userId) {
    const user = await User.findById(userId).select('-passwordHash')
    if (!user) throw new Error('User not found')
    return user
  }

  static async updateProfile(userId, payload) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')
    if (payload.name) user.name = payload.name
    if (payload.email) user.email = payload.email
    if (payload.notifications) {
      user.notifications = {
        sms: !!payload.notifications.sms,
        email: !!payload.notifications.email
      }
    }
    await user.save()
    return { id: user._id, name: user.name, email: user.email, role: user.role, notifications: user.notifications }
  }

  static async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId)
    if (!user) throw new Error('User not found')
    const ok = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!ok) throw new Error('Current password incorrect')
    const hash = await bcrypt.hash(newPassword, 10)
    user.passwordHash = hash
    await user.save()
    return true
  }
}

export const AuthService = AuthServiceImpl
export const login = (email, password, roleOverride = null) => AuthServiceImpl.login(email, password, roleOverride)
export const getProfile = (userId) => AuthServiceImpl.getProfile(userId)
export const updateProfile = (userId, payload) => AuthServiceImpl.updateProfile(userId, payload)
export const changePassword = (userId, currentPassword, newPassword) => AuthServiceImpl.changePassword(userId, currentPassword, newPassword)
