import express from 'express'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
import { generateMaintenanceInsights } from '../services/maintenanceService.js'
const router = express.Router()

// Generate maintenance insights dynamically using hard-coded rules and predictions
// Used by both Dashboard (MaintenanceInsights component) and AIPredictions page
router.get('/:machineId', authenticate, requireRoles('MAINTENANCE_ENGINEER', 'SYSTEM_ADMIN'), async (req, res) => {
  try {
    const { machineId } = req.params
    const horizon = req.query.horizon || '1h'
    console.log(`Generating insights for machine ${machineId} with horizon ${horizon}`)
    const insights = await generateMaintenanceInsights(machineId, horizon)
    console.log(`Generated ${insights.length} insights for machine ${machineId}`)
    res.json(insights)
  } catch (err) {
    console.error('Failed to generate insights', err)
    res.status(500).json({ message: 'Failed to generate insights' })
  }
})

export default router
