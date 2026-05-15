import express from 'express'
import Machine from '../models/Machine.js'
import ActivationEvent from '../models/ActivationEvent.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
const router = express.Router()

// Define safe operating limits for validation
const SAFE_LIMITS = {
  temperature: { min: 0, max: 150 },
  vibration: { min: 0, max: 50 },
  current: { min: 0, max: 200 }
}

const validateThresholds = (t) => {
  const keys = ['temperature', 'vibration', 'current']
  for (const k of keys) {
    const th = t?.[k]
    if (!th || typeof th.warning !== 'number' || typeof th.critical !== 'number') {
      return { ok: false, message: `Invalid threshold for ${k}` }
    }
    const { min, max } = SAFE_LIMITS[k]
    if (th.warning < min || th.warning > max || th.critical < min || th.critical > max) {
      return { ok: false, message: `${k} thresholds must be within ${min}-${max}` }
    }
    if (th.critical <= th.warning) {
      return { ok: false, message: `${k} critical must be greater than warning` }
    }
  }
  return { ok: true }
}

// List machines; include stopped ones so UI can select them. Exclude only PENDING by default.
router.get('/', authenticate, async (req, res) => {
  const includePending = String(req.query.includePending || '').toLowerCase() === 'true'
  const filter = includePending ? {} : { status: { $ne: 'PENDING' } }
  const machines = await Machine.find(filter)
  res.json(machines)
})

// Admin: list pending machines
router.get('/pending', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const machines = await Machine.find({ status: 'PENDING' })
  res.json(machines)
})

// Admin: optional manual registration (if needed)
router.post('/', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { hardwareId, machineName, location, speed, thresholds, status } = req.body
  if (!hardwareId) return res.status(400).json({ message: 'hardwareId is required' })
  const exists = await Machine.findOne({ hardwareId })
  if (exists) return res.status(409).json({ message: 'Machine with this hardwareId already exists' })
  const initialName = machineName || `Pending-${hardwareId.slice(0, 6)}`
  const m = new Machine({ hardwareId, machineName: initialName, location, speed: speed ?? 1000, thresholds, status: status ?? 'PENDING' })
  await m.save()
  res.status(201).json(m)
})

// Admin: update thresholds only
router.put('/:id/thresholds', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { thresholds } = req.body
  const check = validateThresholds(thresholds)
  if (!check.ok) return res.status(400).json({ message: check.message })
  const m = await Machine.findById(id)
  if (!m) return res.status(404).json({ message: 'Not found' })
  m.thresholds = thresholds
  await m.save()
  res.json(m)
})

// Admin: Activate and configure a pending machine
router.post('/:id/activate', authenticate, requireRoles('SYSTEM_ADMIN'), async (req, res) => {
  const { id } = req.params
  const { machineName, location, thresholds } = req.body
  const m = await Machine.findById(id)
  if (!m) return res.status(404).json({ message: 'Machine not found' })
  if (m.status !== 'PENDING') return res.status(400).json({ message: 'Machine is not in PENDING state' })

  const check = validateThresholds(thresholds)
  if (!check.ok) return res.status(400).json({ message: check.message })

  const statusBefore = m.status
  m.machineName = machineName || m.machineName
  m.location = location || m.location
  m.thresholds = thresholds
  m.status = 'RUNNING'
  m.activatedAt = new Date()
  m.activatedBy = req.user?.id
  await m.save()

  // Audit log
  await new ActivationEvent({
    machineId: m._id,
    hardwareId: m.hardwareId,
    activatedBy: req.user?.id,
    machineName: m.machineName,
    location: m.location,
    thresholds,
    statusBefore,
    statusAfter: m.status
  }).save()

  res.json(m)
})

export default router
