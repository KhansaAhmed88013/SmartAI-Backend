import express from 'express'
import Machine from '../models/Machine.js'
import { receiveSensorData } from '../services/machineDataIngestionService.js'

const router = express.Router()

// Example usage (ESP32 or any HTTP client):
// POST /api/sensor-data
// Content-Type: application/json
// Body: {
//   "hardwareId": "HW-12345",
//   "temperature": 35.2,
//   "vibration": 0.18,
//   "current": 1.6,
//   "timestamp": "2026-05-16T12:00:00Z"
// }

const getDefaultThresholds = () => ({
  temperature: { warning: 75, critical: 80 },
  vibration: { warning: 4.5, critical: 6.0 },
  current: { warning: 55, critical: 60 }
})

const isDemoEnabled = () => {
  const demoEnv = typeof process.env.DEMO === 'string' ? process.env.DEMO.toLowerCase().replace(/['"]/g, '') : ''
  return demoEnv === 'true'
}

const handleSensorData = async (req, res) => {
  try {
    const { hardwareId, temperature, vibration, current, timestamp } = req.body || {}

    console.log('Incoming sensor data request', {
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      hardwareId,
      payload: { temperature, vibration, current, timestamp }
    })

    if (!hardwareId) {
      return res.status(400).json({ error: 'hardwareId is required' })
    }

    const parsed = {
      temperature: typeof temperature === 'number' ? temperature : Number(temperature),
      vibration: typeof vibration === 'number' ? vibration : Number(vibration),
      current: typeof current === 'number' ? current : Number(current),
      timestamp: timestamp
    }

    // Basic numeric validation
    if (Number.isNaN(parsed.temperature) || Number.isNaN(parsed.vibration) || Number.isNaN(parsed.current)) {
      return res.status(400).json({ error: 'temperature, vibration and current must be numeric' })
    }

    // Look up machine by hardwareId
    let machine = await Machine.findOne({ hardwareId })

    if (!machine) {
      // Determine if DEMO mode is enabled
      if (isDemoEnabled()) {
        // Auto-create machine in DEMO mode
        machine = new Machine({
          hardwareId,
          machineName: `Auto Machine ${hardwareId}`,
          location: 'Unassigned',
          status: 'RUNNING',
          speed: 1000,
          thresholds: getDefaultThresholds()
        })
        await machine.save()
      } else {
        // Return error in non-DEMO mode
        return res.status(404).json({ error: `Machine with hardwareId ${hardwareId} not found` })
      }
    }

    // Call the existing ingestion flow with the resolved machineId
    const saved = await receiveSensorData(machine._id, parsed)
    return res.json({ success: true, data: saved })
  } catch (err) {
    if (err && err.message && err.message.startsWith('Invalid sensor payload')) {
      return res.status(400).json({ error: err.message })
    }
    console.error('Error in /api/sensor-data:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}

router.post('/', handleSensorData)

// Simple GET example that returns a sample payload for clients
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
