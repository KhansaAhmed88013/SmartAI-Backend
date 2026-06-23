import express from 'express'
import SensorData from '../models/SensorData.js'
import Machine from '../models/Machine.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
const router = express.Router()

router.get('/history/:machineId', authenticate, requireRoles('MAINTENANCE_ENGINEER', 'SYSTEM_ADMIN'), async (req, res) => {
  const { machineId } = req.params
  const range = req.query.range || '24h'
  // parse range like '24h'
  const hours = parseInt(range.replace(/[^0-9]/g, '')) || 24
  const since = new Date(Date.now() - hours * 3600 * 1000)
  const data = await SensorData.find({ machineId, timestamp: { $gte: since } }).sort({ timestamp: 1 })
  res.json(data)
})

router.get('/peak-hours/:machineId', authenticate, requireRoles('MAINTENANCE_ENGINEER', 'SYSTEM_ADMIN'), async (req, res) => {
  const { machineId } = req.params
  const machine = await Machine.findById(machineId).select('thresholds.current').lean()
  const data = await SensorData.find({ machineId }).sort({ timestamp: -1 }).limit(500)
  // aggregate by hour
  const hours = {}
  data.forEach(d => {
    const h = new Date(d.timestamp).getHours()
    hours[h] = hours[h] || { usage: 0, count: 0 }
    hours[h].usage += d.current
    hours[h].count++
  })
  const criticalCurrent = Number(machine?.thresholds?.current?.critical)
  const hasBaseline = Number.isFinite(criticalCurrent) && criticalCurrent > 0
  const result = Object.keys(hours)
    .map(h => {
      const averageCurrent = hours[h].usage / Math.max(1, hours[h].count)
      const usage = hasBaseline ? (averageCurrent / criticalCurrent) * 100 : averageCurrent
      return {
        hour: `${h}:00`,
        usage: Number(Math.max(0, usage).toFixed(2)),
        current: Number(averageCurrent.toFixed(2))
      }
    })
    .sort((a, b) => Number.parseInt(a.hour, 10) - Number.parseInt(b.hour, 10))
  res.json(result)
})

export default router
