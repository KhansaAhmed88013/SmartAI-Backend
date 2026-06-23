import SensorData from '../models/SensorData.js'
import Prediction from '../models/Prediction.js'

const horizonMinutes = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 }

class ForecastServiceImpl {
  // Simple forecast: moving average plus linear slope projection
  static async generatePrediction(machineId, horizonKey) {
    const minutes = horizonMinutes[horizonKey] || 60
    const recent = await SensorData.find({ machineId }).sort({ timestamp: -1 }).limit(60)
    if (!recent || recent.length === 0) return null
    const reversed = recent.slice().reverse()

    const avg = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length
    const tempAvg = avg(reversed, 'temperature')
    const vibAvg = avg(reversed, 'vibration')
    const currAvg = avg(reversed, 'current')

    const first = reversed[0]
    const last = reversed[reversed.length - 1]
    const minutesSpan = (last.timestamp - first.timestamp) / 60000 || 1
    const slope = (valKey) => ((last[valKey] - first[valKey]) / minutesSpan) * minutes

    const predict = (base, key) => {
      const s = slope(key)
      const projection = base + s
      const noise = (Math.random() - 0.5) * base * 0.02
      return Math.round((projection + noise) * 10) / 10
    }

    const predictedTemp = predict(tempAvg, 'temperature')
    const predictedVib = predict(vibAvg, 'vibration')
    const predictedCurr = predict(currAvg, 'current')

    const confidence = Math.max(0.2, Math.min(0.99, 0.95 - (minutes / 1440) * 0.25 - (1 / reversed.length)))

    const doc = new Prediction({
      machineId,
      horizon: horizonKey,
      temperature: predictedTemp,
      vibration: predictedVib,
      current: predictedCurr,
      confidence: Math.round(confidence * 100) / 100,
      predictionSource: 'FORECAST_SERVICE'
    })
    await doc.save()
    return doc
  }
}

export const ForecastService = ForecastServiceImpl
export const generatePrediction = (machineId, horizonKey) => ForecastServiceImpl.generatePrediction(machineId, horizonKey)
