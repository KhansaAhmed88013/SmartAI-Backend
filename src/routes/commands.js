import express from 'express'
import Command from '../models/Command.js'
import Machine from '../models/Machine.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
const router = express.Router()

// create command (any authenticated user)
router.post('/', authenticate, async (req, res) => {
  try {
    const { machineId, commandType, payload } = req.body
    console.log('POST /api/commands by user', req.user && (req.user.id || req.user.email), 'body:', { machineId, commandType, payload })

    // basic validation
    if (!machineId) return res.status(400).json({ message: 'machineId is required' })
    const m = await Machine.findById(machineId)
    if (!m) return res.status(404).json({ message: 'Machine not found' })

    const allowed = ['STOP_MACHINE', 'REDUCE_SPEED', 'START_MACHINE']
    if (!allowed.includes(commandType)) return res.status(400).json({ message: 'Invalid commandType' })

    // RBAC enforcement
    const role = req.user?.role
    const isSystemAdmin = ['SYSTEM_ADMIN', 'ADMIN'].includes(role)
    const isMaint = ['MAINTENANCE_ENGINEER'].includes(role)
    // Operators cannot send any commands in this policy
    const isOperator = ['MACHINE_OPERATOR', 'OPERATOR'].includes(role)

    if (commandType === 'STOP_MACHINE' || commandType === 'START_MACHINE') {
      if (!isSystemAdmin) return res.status(403).json({ message: 'Forbidden: requires SYSTEM_ADMIN' })
    }
    if (commandType === 'REDUCE_SPEED') {
      if (!(isSystemAdmin || isMaint)) return res.status(403).json({ message: 'Forbidden: requires MAINTENANCE_ENGINEER or SYSTEM_ADMIN' })
    }

    const cmd = new Command({ machineId, commandType, payload: payload || {} })
    await cmd.save()
    console.log('Saved command', cmd._id.toString())
    res.status(201).json(cmd)
  } catch (err) {
    console.error('Failed to create command', err && err.stack ? err.stack : err)
    res.status(500).json({ message: err.message || 'Failed to create command' })
  }
})

// fetch pending commands for machine
router.get('/pending/:machineId', authenticate, async (req, res) => {
  const { machineId } = req.params
  const cmds = await Command.find({ machineId, status: 'PENDING' }).sort({ createdAt: 1 })
  res.json(cmds)
})

// allow admin to mark resolved or force-execute
router.put('/:id/execute', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { id } = req.params
  const cmd = await Command.findById(id)
  if (!cmd) return res.status(404).json({ message: 'Not found' })
  cmd.status = 'EXECUTED'
  cmd.executedAt = new Date()
  await cmd.save()
  res.json(cmd)
})

export default router
