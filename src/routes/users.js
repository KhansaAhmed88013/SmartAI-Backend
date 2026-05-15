import express from 'express'
import bcrypt from 'bcrypt'
import User from '../models/User.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'

const router = express.Router()

// List users (SYSTEM_ADMIN only)
router.get('/', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 })
  res.json(users)
})

// Create user with role (SYSTEM_ADMIN only)
router.post('/', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password || !role) return res.status(400).json({ message: 'name, email, password, role are required' })
  const validRoles = ['SYSTEM_ADMIN', 'MAINTENANCE_ENGINEER', 'MACHINE_OPERATOR']
  if (!validRoles.includes(role)) return res.status(400).json({ message: 'Invalid role' })
  const exists = await User.findOne({ email })
  if (exists) return res.status(409).json({ message: 'User with this email already exists' })
  const hash = await bcrypt.hash(password, 10)
  const u = new User({ name, email, passwordHash: hash, role })
  await u.save()
  res.status(201).json({ id: u._id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })
})

// Update user role (SYSTEM_ADMIN only)
router.put('/:id/role', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { role } = req.body
  const validRoles = ['SYSTEM_ADMIN', 'MAINTENANCE_ENGINEER', 'MACHINE_OPERATOR']
  if (!validRoles.includes(role)) return res.status(400).json({ message: 'Invalid role' })
  const u = await User.findById(id)
  if (!u) return res.status(404).json({ message: 'User not found' })
  u.role = role
  await u.save()
  res.json({ id: u._id, name: u.name, email: u.email, role: u.role })
})

// Optional: delete user (SYSTEM_ADMIN only)
router.delete('/:id', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { id } = req.params
  const u = await User.findById(id)
  if (!u) return res.status(404).json({ message: 'User not found' })
  await u.deleteOne()
  res.json({ deleted: true })
})

export default router