import Machine from '../models/Machine.js'
import SensorData from '../models/SensorData.js'
import Alert from '../models/Alert.js'
import Command from '../models/Command.js'
import { ForecastService } from './forecastService.js'

const horizons = ['15m', '1h', '6h', '24h']

const VIBRATION_HISTORY_LIMIT = 12
const VIBRATION_MEDIAN_WINDOW = 5
const VIBRATION_ZERO_EPSILON = 0.02
const VIBRATION_EWMA_ALPHA = 0.35
const VIBRATION_SPIKE_Z_THRESHOLD = 3.5
const VIBRATION_MAX_RELATIVE_JUMP = 0.45
const MIN_HISTORY_FOR_SPIKE_CHECK = 3

const validatePayload = (payload) => {
  const keys = ['temperature', 'vibration', 'current']
  for (const k of keys) {
    const val = payload?.[k]
    if (typeof val !== 'number' || Number.isNaN(val)) {
      throw new Error(`Invalid sensor payload: ${k} must be a number`)
    }
  }
}

const mean = (arr) => {
  if (!arr.length) return 0
  return arr.reduce((sum, v) => sum + v, 0) / arr.length
}

const median = (arr) => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const getRecentVibrations = async (machineId) => {
  const docs = await SensorData.find({ machineId })
    .sort({ timestamp: -1 })
    .limit(VIBRATION_HISTORY_LIMIT)
    .lean()

  return docs
    .map((d) => Number(d.vibration))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .reverse()
}

const smoothVibrationReading = async (machineId, rawVibration) => {
  const history = await getRecentVibrations(machineId)
  const recentWindow = history.slice(-VIBRATION_MEDIAN_WINDOW)

  const validHistory = history.filter((v) => v > VIBRATION_ZERO_EPSILON)
  const baseline = recentWindow.length
    ? median(recentWindow)
    : validHistory.length
      ? mean(validHistory)
      : rawVibration

  if (!Number.isFinite(rawVibration)) {
    return {
      rawVibration,
      cleanedVibration: baseline,
      method: 'invalid-fallback'
    }
  }

  // Replace 0 / near-zero drops with a stable local baseline
  if (rawVibration <= VIBRATION_ZERO_EPSILON) {
    return {
      rawVibration,
      cleanedVibration: baseline,
      method: 'zero-filled'
    }
  }

  // When there is not enough history, use gentle smoothing only
  if (history.length < MIN_HISTORY_FOR_SPIKE_CHECK) {
    const last = history.length ? history[history.length - 1] : rawVibration
    const cleaned = history.length
      ? (VIBRATION_EWMA_ALPHA * rawVibration) + ((1 - VIBRATION_EWMA_ALPHA) * last)
      : rawVibration

    return {
      rawVibration,
      cleanedVibration: Number(cleaned.toFixed(4)),
      method: history.length ? 'ewma-warmup' : 'raw'
    }
  }

  const med = recentWindow.length ? median(recentWindow) : median(history)
  const deviations = (recentWindow.length ? recentWindow : history).map((v) => Math.abs(v - med))
  const mad = median(deviations) || 1e-6

  const lastValid = history[history.length - 1]
  const robustZ = Math.abs(rawVibration - med) / (1.4826 * mad)
  const relativeJump = Math.abs(rawVibration - lastValid) / (Math.abs(lastValid) + 1e-6)

  let cleanedVibration = rawVibration

  // Strong spike or sudden drop: pull it toward the local median
  if (robustZ > VIBRATION_SPIKE_Z_THRESHOLD || relativeJump > VIBRATION_MAX_RELATIVE_JUMP) {
    cleanedVibration = (0.70 * med) + (0.30 * rawVibration)
  } else {
    // Normal variation: smooth it with EWMA
    cleanedVibration = (VIBRATION_EWMA_ALPHA * rawVibration) + ((1 - VIBRATION_EWMA_ALPHA) * lastValid)
  }

  return {
    rawVibration,
    cleanedVibration: Number(clamp(cleanedVibration, 0, Number.MAX_SAFE_INTEGER).toFixed(4)),
    method: 'smoothed'
  }
}

const applyCommandEffects = async (machine, command) => {
  if (!machine.hardwareId) {
    machine.hardwareId = `HW-${Math.random().toString(36).slice(2, 10)}`
    console.warn(`Machine ${machine._id.toString()} was missing hardwareId; assigned ${machine.hardwareId}`)
  }

  if (command.commandType === 'STOP_MACHINE') {
    machine.status = 'STOPPED'
    machine.speed = 0
  }

  if (command.commandType === 'REDUCE_SPEED') {
    const requested = command.payload && command.payload.newSpeed
    const newSpeed = typeof requested === 'number' ? requested : Math.max(0, machine.speed * 0.8)
    machine.speed = newSpeed
  }

  if (command.commandType === 'START_MACHINE') {
    machine.status = 'RUNNING'
    const requested = command.payload && command.payload.newSpeed
    const fallback = machine.speed > 0 ? machine.speed : 1000
    machine.speed = typeof requested === 'number' ? requested : fallback
  }

  await machine.save()
  command.status = 'EXECUTED'
  command.executedAt = new Date()
  await command.save()
}

const dispatchPendingCommands = async (machine) => {
  const pending = await Command.find({ machineId: machine._id, status: 'PENDING' }).sort({ createdAt: 1 })
  if (!pending.length) return { dispatched: [] }

  const dispatched = []
  for (const cmd of pending) {
    await applyCommandEffects(machine, cmd)
    dispatched.push(cmd)
  }
  return { dispatched }
}

const createActualAlerts = async (machine, sensorDoc) => {
  if (!machine.thresholds || machine.status === 'PENDING') return

  const checks = [
    { param: 'temperature', value: sensorDoc.temperature, thresh: machine.thresholds.temperature },
    { param: 'vibration', value: sensorDoc.vibration, thresh: machine.thresholds.vibration },
    { param: 'current', value: sensorDoc.current, thresh: machine.thresholds.current }
  ]

  for (const c of checks) {
    if (!c.thresh) continue

    if (c.value > c.thresh.critical) {
      await new Alert({
        machineId: machine._id,
        parameter: c.param,
        value: c.value,
        threshold: c.thresh.critical,
        severity: 'HIGH',
        source: 'ACTUAL',
        message: `${c.param} exceeded critical`,
        timestamp: new Date()
      }).save()
    } else if (c.value > c.thresh.warning) {
      await new Alert({
        machineId: machine._id,
        parameter: c.param,
        value: c.value,
        threshold: c.thresh.warning,
        severity: 'MEDIUM',
        source: 'ACTUAL',
        message: `${c.param} exceeded warning`,
        timestamp: new Date()
      }).save()
    }
  }
}

const createPredictedAlerts = async (machine, prediction, horizonKey) => {
  if (!machine.thresholds) return

  const minsMap = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 }
  const mins = minsMap[horizonKey] || 60

  const checks = [
    { param: 'temperature', value: prediction.temperature, thresh: machine.thresholds.temperature },
    { param: 'vibration', value: prediction.vibration, thresh: machine.thresholds.vibration },
    { param: 'current', value: prediction.current, thresh: machine.thresholds.current }
  ]

  for (const c of checks) {
    if (!c.thresh) continue

    const base = `${c.param} predicted to exceed threshold in ~${mins} minutes (horizon ${horizonKey})`

    if (c.value > c.thresh.critical) {
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: 'PREDICTED',
        severity: 'HIGH',
        resolved: false,
        threshold: c.thresh.critical
      })

      if (!exists) {
        await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.critical,
          severity: 'HIGH',
          source: 'PREDICTED',
          message: `${base} (critical)`,
          timestamp: new Date()
        }).save()
      }
    } else if (c.value > c.thresh.warning) {
      const exists = await Alert.findOne({
        machineId: machine._id,
        parameter: c.param,
        source: 'PREDICTED',
        severity: 'MEDIUM',
        resolved: false,
        threshold: c.thresh.warning
      })

      if (!exists) {
        await new Alert({
          machineId: machine._id,
          parameter: c.param,
          value: c.value,
          threshold: c.thresh.warning,
          severity: 'MEDIUM',
          source: 'PREDICTED',
          message: `${base} (warning)`,
          timestamp: new Date()
        }).save()
      }
    }
  }
}

const generatePredictions = async (machine) => {
  const results = []
  if (machine.status === 'PENDING') return results

  for (const horizon of horizons) {
    const prediction = await ForecastService.generatePrediction(machine._id, horizon)
    if (prediction) {
      results.push({ horizon, prediction })
      try {
        await createPredictedAlerts(machine, prediction, horizon)
      } catch (err) {
        console.error('Error creating predicted alerts', err)
      }
    }
  }
  return results
}

export class MachineDataIngestionService {
  static async receiveSensorData(machineId, payload) {
    validatePayload(payload)

    const machine = await Machine.findById(machineId)
    if (!machine) throw new Error('Machine not found')

    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date()
    const vibrationResult = await smoothVibrationReading(machineId, payload.vibration)

    const sensorDoc = new SensorData({
      machineId,
      temperature: payload.temperature,
      rawVibration: vibrationResult.rawVibration,
      vibration: vibrationResult.cleanedVibration,
      current: payload.current,
      timestamp
    })

    await sensorDoc.save()

    await dispatchPendingCommands(machine)
    await createActualAlerts(machine, sensorDoc)
    await generatePredictions(machine)

    return sensorDoc
  }
}

export const receiveSensorData = (machineId, payload) =>
  MachineDataIngestionService.receiveSensorData(machineId, payload)