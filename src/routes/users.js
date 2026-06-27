import express from 'express'
import bcrypt from 'bcrypt'
import User from '../models/User.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'

const router = express.Router()

// --------------------------------------------------
// List Users (SYSTEM_ADMIN only)
// --------------------------------------------------

router.get(
  '/',
  authenticate,
  requireRoles('SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const users = await User.find()
        .select('-passwordHash')
        .sort({ createdAt: -1 })

      res.json(users)
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// --------------------------------------------------
// Create User (SYSTEM_ADMIN only)
// --------------------------------------------------

router.post(
  '/',
  authenticate,
  requireRoles('SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const { name, email, password, role } = req.body

      if (!name || !email || !password || !role) {
        return res.status(400).json({
          message: 'name, email, password and role are required'
        })
      }

      const validRoles = [
        'SYSTEM_ADMIN',
        'MACHINE_OPERATOR'
      ]

      if (!validRoles.includes(role)) {
        return res.status(400).json({
          message: 'Invalid role'
        })
      }

      const exists = await User.findOne({ email })

      if (exists) {
        return res.status(409).json({
          message: 'User with this email already exists'
        })
      }

      const hash = await bcrypt.hash(password, 10)

      const user = new User({
        name,
        email,
        passwordHash: hash,
        role
      })

      await user.save()

      res.status(201).json({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      })

    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

// --------------------------------------------------
// Update User Role (SYSTEM_ADMIN only)
// --------------------------------------------------

router.put(
  '/:id/role',
  authenticate,
  requireRoles('SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const { id } = req.params
      const { role } = req.body

      const validRoles = [
        'SYSTEM_ADMIN',
        'MACHINE_OPERATOR'
      ]

      if (!validRoles.includes(role)) {
        return res.status(400).json({
          message: 'Invalid role'
        })
      }

      const user = await User.findById(id)

      if (!user) {
        return res.status(404).json({
          message: 'User not found'
        })
      }

      user.role = role

      await user.save()

      res.json({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      })

    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

// --------------------------------------------------
// Delete User (SYSTEM_ADMIN only)
// --------------------------------------------------

router.delete(
  '/:id',
  authenticate,
  requireRoles('SYSTEM_ADMIN'),
  async (req, res) => {
    try {
      const { id } = req.params

      const user = await User.findById(id)

      if (!user) {
        return res.status(404).json({
          message: 'User not found'
        })
      }

      await user.deleteOne()

      res.json({
        deleted: true
      })

    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

export default router