import express from 'express'
import Prediction from '../models/Prediction.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
const router = express.Router()

router.get('/:machineId', authenticate, requireRoles('MAINTENANCE_ENGINEER', 'SYSTEM_ADMIN'), async (req, res) => {
  const { machineId } = req.params
  const horizon = req.query.horizon || '1h'
  const preds = await Prediction.find({ machineId, horizon }).sort({ createdAt: -1 }).limit(10)
  res.json(preds)
})

export default router
