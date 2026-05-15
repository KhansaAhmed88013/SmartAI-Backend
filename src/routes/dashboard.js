import express from 'express'
import SensorData from '../models/SensorData.js'
import Alert from '../models/Alert.js'
import Machine from '../models/Machine.js'
import { authenticate } from '../middleware/auth.js'
const router = express.Router()

router.get('/kpis/:machineId', authenticate, async (req, res) => {
  const { machineId } = req.params
  const latest = await SensorData.findOne({ machineId }).sort({ timestamp: -1 })
  if (!latest) return res.status(404).json({ message: 'No data' })
  res.json({ temperature: latest.temperature, vibration: latest.vibration, current: latest.current, timestamp: latest.timestamp })
})

router.get('/alerts/active', authenticate, async (req, res) => {
  try {
    const sinceDays = parseInt(req.query.sinceDays || '3')
    const since = new Date(Date.now() - Math.max(0, sinceDays) * 24 * 60 * 60 * 1000)
    const alerts = await Alert.find({ resolved: false, timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(100)
    res.json(alerts)
  } catch (err) {
    console.error('Failed to load active alerts', err)
    res.status(500).json({ message: 'Failed to load active alerts' })
  }
})

// Paginated alerts with filters: page, limit, severity, startDate, endDate, resolved
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'))
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50')))
    const skip = (page - 1) * limit

    const filter = {}
    if (req.query.machineId) filter.machineId = req.query.machineId
    if (req.query.severity && req.query.severity !== 'All') filter.severity = req.query.severity
    if (req.query.resolved === 'true') filter.resolved = true
    if (req.query.resolved === 'false') filter.resolved = false
    if (req.query.startDate) filter.timestamp = { ...(filter.timestamp || {}), $gte: new Date(req.query.startDate) }
    if (req.query.endDate) filter.timestamp = { ...(filter.timestamp || {}), $lte: new Date(req.query.endDate) }

    const total = await Alert.countDocuments(filter)
    const items = await Alert.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit)
    res.json({ page, limit, total, items })
  } catch (err) {
    console.error('Failed to list alerts', err)
    res.status(500).json({ message: 'Failed to list alerts' })
  }
})

// Delete all resolved (read) alerts
router.delete('/alerts/resolved', authenticate, async (req, res) => {
  try {
    const result = await Alert.deleteMany({ resolved: true })
    return res.json({ deletedCount: result.deletedCount })
  } catch (err) {
    console.error('Failed to delete resolved alerts', err)
    return res.status(500).json({ message: 'Failed to delete resolved alerts' })
  }
})

// Mark single alert as resolved (read)
router.patch('/alerts/:id/resolve', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const alert = await Alert.findByIdAndUpdate(id, { resolved: true }, { new: true })
    if (!alert) return res.status(404).json({ message: 'Alert not found' })
    return res.json(alert)
  } catch (err) {
    console.error('Failed to mark alert resolved', err)
    return res.status(500).json({ message: 'Failed to mark alert resolved' })
  }
})

// Bulk mark alerts resolved. Body: { ids: [id1,id2] } or empty to mark all active resolved
router.post('/alerts/resolve', authenticate, async (req, res) => {
  try {
    const { ids } = req.body || {}
    let result
    if (Array.isArray(ids) && ids.length > 0) {
      result = await Alert.updateMany({ _id: { $in: ids } }, { $set: { resolved: true } })
    } else {
      result = await Alert.updateMany({ resolved: false }, { $set: { resolved: true } })
    }
    return res.json({ modifiedCount: result.modifiedCount ?? result.nModified ?? 0 })
  } catch (err) {
    console.error('Failed to bulk-resolve alerts', err)
    return res.status(500).json({ message: 'Failed to bulk-resolve alerts' })
  }
})

export default router
