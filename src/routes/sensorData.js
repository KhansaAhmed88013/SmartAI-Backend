import express from 'express'
import Machine from '../models/Machine.js'
import { receiveSensorData } from '../services/machineDataIngestionService.js'

const router = express.Router()

const handleSensorData = async (req, res) => {
  try {
    const { hardwareId, temperature, vibration, current, timestamp } = req.body || {}

    if (!hardwareId) {
      return res.status(400).json({ error: 'hardwareId is required' })
    }

    const parsed = {
      temperature: typeof temperature === 'number' ? temperature : Number(temperature),
      vibration: typeof vibration === 'number' ? vibration : Number(vibration),
      current: typeof current === 'number' ? current : Number(current),
      timestamp
    }

    if (
      !Number.isFinite(parsed.temperature) ||
      !Number.isFinite(parsed.vibration) ||
      !Number.isFinite(parsed.current)
    ) {
      return res.status(400).json({
        error: 'temperature, vibration and current must be numeric'
      })
    }

    let machine = await Machine.findOne({ hardwareId })

    if (!machine) {
      machine = new Machine({
        hardwareId,
        machineName: `Pending-${hardwareId.slice(0, 6)}`, 
        location: 'Unassigned',
        status: 'PENDING',
        speed: 0
      })
      console.warn(`Auto-registered new PENDING machine for hardwareId ${hardwareId}`)
      await machine.save()
    }
    console.log("API SENSOR ROUTE HIT");
console.log(machine._id);

    const saved = await receiveSensorData(machine._id, parsed)
    return res.json({ success: true, data: saved })
  } catch (err) {
    if (err?.message?.startsWith('Invalid sensor payload')) {
      return res.status(400).json({ error: err.message })
    }
    console.error('Error in /api/sensor-data:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

router.post('/', handleSensorData)

router.get('/example', (req, res) => {
  res.json({
    method: 'POST',
    url: '/api/sensor-data',
    contentType: 'application/json',
    body: {
      hardwareId: 'HW-12345',
      temperature: 35.2,
      vibration: 0.18,
      current: 1.6,
      timestamp: '2026-05-16T12:00:00Z'
    }
  })
})

export default router