import express from 'express'
import { login, getProfile, updateProfile, changePassword } from '../services/authService.js'
import { authenticate } from '../middleware/auth.js'
const router = express.Router()

router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body
    const data = await login(email, password, role)
    res.json(data)
  } catch (err) {
    res.status(401).json({ message: err.message })
  }
})

router.get('/me', authenticate, async (req, res) => {
  try {
    console.log('Authenticated user:', req.user)
    const user = await getProfile(req.user.id)
    res.json(user)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.put('/me', authenticate, async (req, res) => {
  try {
    const updated = await updateProfile(req.user.id, req.body)
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.put('/me/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    await changePassword(req.user.id, currentPassword, newPassword)
    res.json({ message: 'Password changed' })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

export default router
