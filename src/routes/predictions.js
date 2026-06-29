import express from 'express'
import Prediction from '../models/Prediction.js'
import ModelEvaluation from '../models/ModelEvaluation.js'
import { authenticate } from '../middleware/auth.js'
import { requireRoles } from '../middleware/role.js'
const router = express.Router()

router.get('/model-performance', authenticate, async (req, res) => {
  try {
    const [tempEval, currEval, vibEval] = await Promise.all([
      ModelEvaluation.findOne({ modelName: 'temperature' }).sort({ evaluatedAt: -1 }),
      ModelEvaluation.findOne({ modelName: 'current' }).sort({ evaluatedAt: -1 }),
      ModelEvaluation.findOne({ modelName: 'vibration' }).sort({ evaluatedAt: -1 })
    ])

    const tempMetrics = tempEval ? {
      accuracy: Number(tempEval.accuracy.toFixed(2)),
      mae: Number(tempEval.newMAE.toFixed(4)),
      rmse: Number(tempEval.newRMSE.toFixed(4)),
      mape: Number(tempEval.newMAPE.toFixed(2))
    } : null

    const currMetrics = currEval ? {
      accuracy: Number(currEval.accuracy.toFixed(2)),
      mae: Number(currEval.newMAE.toFixed(4)),
      rmse: Number(currEval.newRMSE.toFixed(4)),
      mape: Number(currEval.newMAPE.toFixed(2))
    } : null

    const vibMetrics = vibEval ? {
      accuracy: Number(vibEval.accuracy.toFixed(2)),
      mae: Number(vibEval.newMAE.toFixed(4)),
      rmse: Number(vibEval.newRMSE.toFixed(4)),
      mape: Number(vibEval.newMAPE.toFixed(2))
    } : null

    const allEvals = [tempEval, currEval, vibEval].filter(Boolean)
    const lastEvaluated = allEvals.length > 0
      ? new Date(Math.max(...allEvals.map(e => new Date(e.evaluatedAt).getTime())))
      : new Date()
    const lastRetrained = lastEvaluated

    res.json({
      predictionEngine: 'Autoformer AI',
      modelType: 'Time-Series Forecasting',
      temperatureModel: tempMetrics,
      currentModel: currMetrics,
      vibrationModel: vibMetrics,
      predictionLength: '24 Forecast Points',
      lastRetrained: lastRetrained.toLocaleString(),
      lastEvaluated: lastEvaluated.toLocaleString()
    })
  } catch (err) {
    console.error('Failed to fetch model performance metrics', err)
    res.status(500).json({ message: 'Failed to fetch model performance metrics' })
  }
})

router.get('/predictions/:machineId', authenticate, requireRoles('MAINTENANCE_ENGINEER', 'SYSTEM_ADMIN'), async (req, res) => {
  const { machineId } = req.params
  const horizon = req.query.horizon || '1h'
  const preds = await Prediction.find({ machineId, horizon }).sort({ createdAt: -1 }).limit(10)
  
  console.log(`[Backend API] GET /api/predictions/${machineId}?horizon=${horizon} - Found ${preds.length} predictions`);
  preds.forEach((p, idx) => {
    console.log(`[Backend API] Prediction index ${idx}:
      _id: ${p._id}
      createdAt: ${p.createdAt}
      horizon: ${p.horizon}
      temperature: ${p.temperature}
      vibration: ${p.vibration}
      current: ${p.current}
      forecastValues: ${JSON.stringify(p.forecastValues)}
      temperatureForecastValues: ${JSON.stringify(p.temperatureForecastValues)}
      currentForecastValues: ${JSON.stringify(p.currentForecastValues)}
      vibrationForecastValues: ${JSON.stringify(p.vibrationForecastValues)}`);
  });

  res.json(preds)
})

export default router
