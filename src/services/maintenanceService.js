import Machine from '../models/Machine.js'
import SensorData from '../models/SensorData.js'
import Prediction from '../models/Prediction.js'

const THRESHOLDS = {
  temperature: {
    immediate: 85,
    urgent: 80,
    warning: 75,
    normal: 70
  },
  vibration: {
    immediate: 7.0,
    urgent: 6.0,
    warning: 4.5,
    normal: 3.0
  },
  current: {
    immediate: 65,
    urgent: 60,
    warning: 55,
    normal: 50
  }
}

const getMaintenanceSeverity = (value, thresholds) => {
  if (value >= thresholds.immediate) return 'CRITICAL'
  if (value >= thresholds.urgent) return 'HIGH'
  if (value >= thresholds.warning) return 'MEDIUM'
  return 'LOW'
}

const getMaintenanceMessage = (parameter, value, severity) => {
  const paramLabel = parameter.charAt(0).toUpperCase() + parameter.slice(1)
  
  switch (severity) {
    case 'CRITICAL':
      return `${paramLabel}: Immediate inspection required (${value})`
    case 'HIGH':
      return `${paramLabel}: Urgent maintenance recommended (${value})`
    case 'MEDIUM':
      return `${paramLabel}: Schedule maintenance soon (${value})`
    case 'LOW':
      return `${paramLabel}: Normal operation (${value})`
    default:
      return `${paramLabel}: Under normal limits`
  }
}

const getMaintenanceAction = (parameter, severity) => {
  const paramLabel = parameter.charAt(0).toUpperCase() + parameter.slice(1)
  
  switch (severity) {
    case 'CRITICAL':
      return `Stop machine immediately. Schedule emergency ${parameter} system inspection.`
    case 'HIGH':
      return `Plan urgent ${parameter} system maintenance within 24 hours.`
    case 'MEDIUM':
      return `Schedule ${parameter} system maintenance within 1 week. Monitor closely.`
    case 'LOW':
      return `Continue normal operation. Routine maintenance as scheduled.`
    default:
      return 'No action required.'
  }
}

class MaintenanceServiceImpl {
  // Generate maintenance recommendations based on current sensor values
  static async generateCurrentValueMaintenance(machineId) {
    const machine = await Machine.findById(machineId)
    if (!machine) return []

    const latest = await SensorData.findOne({ machineId }).sort({ timestamp: -1 })
    if (!latest) return []

    const recommendations = []

    // Analyze each parameter
    const parameters = ['temperature', 'vibration', 'current']
    for (const param of parameters) {
      const value = latest[param]
      const thresh = THRESHOLDS[param]

      if (value === undefined || value === null) continue

      const severity = getMaintenanceSeverity(value, thresh)
      if (severity !== 'LOW') {
        const message = getMaintenanceMessage(param, value, severity)
        const action = getMaintenanceAction(param, severity)

        recommendations.push({
          message,
          severity,
          source: 'ACTUAL',
          recommendedAction: action,
          parameter: param,
          value,
          type: 'CURRENT_VALUE'
        })
      }
    }

    // Sort by severity (CRITICAL > HIGH > MEDIUM)
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return recommendations
  }

  // Generate maintenance recommendations based on predicted values
  static async generatePredictiveMaintenance(machineId, horizonKey = '1h') {
    const machine = await Machine.findById(machineId)
    if (!machine) return []

    const prediction = await Prediction.findOne({ machineId, horizon: horizonKey }).sort({ createdAt: -1 })
    if (!prediction) return []

    const recommendations = []
    const horizonLabels = { '15m': '15 minutes', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours' }
    const timeframe = horizonLabels[horizonKey] || horizonKey

    // Analyze predicted values
    const parameters = ['temperature', 'vibration', 'current']
    for (const param of parameters) {
      const predictedValue = prediction[param]
      const thresh = THRESHOLDS[param]

      if (predictedValue === undefined || predictedValue === null) continue

      const severity = getMaintenanceSeverity(predictedValue, thresh)

      // Only include if prediction shows issues
      if (severity !== 'LOW') {
        const paramLabel = param.charAt(0).toUpperCase() + param.slice(1)
        let message = ''
        let action = ''

        switch (severity) {
          case 'CRITICAL':
            message = `${paramLabel}: Critical level predicted in ~${timeframe} (${predictedValue})`
            action = `High priority: ${paramLabel} system will require immediate maintenance within ${timeframe}. Consider preemptive shutdown.`
            break
          case 'HIGH':
            message = `${paramLabel}: High level predicted in ~${timeframe} (${predictedValue})`
            action = `Urgent: Plan ${paramLabel} system maintenance before issue develops in ${timeframe}.`
            break
          case 'MEDIUM':
            message = `${paramLabel}: Warning level predicted in ~${timeframe} (${predictedValue})`
            action = `Preventive: Schedule ${paramLabel} system maintenance in next scheduled window to avoid future issues.`
            break
          default:
            continue
        }

        recommendations.push({
          message,
          severity,
          source: 'PREDICTED',
          recommendedAction: action,
          parameter: param,
          value: predictedValue,
          horizon: horizonKey,
          confidence: prediction.confidence || 0,
          type: 'PREDICTIVE'
        })
      }
    }

    // Check for multi-parameter degradation (predictive)
    const criticalParams = recommendations.filter(r => r.severity === 'CRITICAL')
    if (criticalParams.length >= 2) {
      recommendations.unshift({
        message: `Multiple critical parameters predicted within ${timeframe} — severe failure risk`,
        severity: 'CRITICAL',
        source: 'PREDICTED',
        recommendedAction: 'Highest priority: Initiate comprehensive machine inspection and consider operational shutdown.',
        parameter: 'combined',
        type: 'PREDICTIVE_COMBINED',
        horizon: horizonKey
      })
    }

    // Sort by severity
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

    return recommendations
  }

  // Combine both current-value and predictive maintenance recommendations
  static async generateCombinedMaintenance(machineId, horizonKey = '1h') {
    const current = await this.generateCurrentValueMaintenance(machineId)
    const predictive = await this.generatePredictiveMaintenance(machineId, horizonKey)
    return { current, predictive }
  }

  // Transform maintenance recommendations to UI-friendly format
  // Used by frontend to render maintenance insights on Dashboard and AIPredictions page
  static async generateMaintenanceInsights(machineId, horizonKey = '1h') {
    const maintenance = await this.generatePredictiveMaintenance(machineId, horizonKey)
    
    // Transform maintenance recommendations to UI format
    return maintenance.map(rec => {
      const paramLabel = rec.parameter === 'combined' ? 'System' : (rec.parameter.charAt(0).toUpperCase() + rec.parameter.slice(1))
      const severityLevel = rec.severity === 'CRITICAL' ? 'High' : rec.severity === 'HIGH' ? 'High' : 'Medium'
      
      return {
        title: paramLabel,
        description: rec.message,
        severity: severityLevel,
        action: rec.recommendedAction,
        icon: rec.severity === 'CRITICAL' ? '⚠️' : rec.severity === 'HIGH' ? '⚠️' : '📋',
        timeToIssue: rec.horizon ? (rec.horizon === '15m' ? '~15 min' : rec.horizon === '1h' ? '~1 hour' : rec.horizon === '6h' ? '~6 hours' : '~24 hours') : 'Unknown'
      }
    })
  }
}

export const MaintenanceService = MaintenanceServiceImpl
export const generateCurrentValueMaintenance = (machineId) => MaintenanceServiceImpl.generateCurrentValueMaintenance(machineId)
export const generatePredictiveMaintenance = (machineId, horizonKey) => MaintenanceServiceImpl.generatePredictiveMaintenance(machineId, horizonKey)
export const generateCombinedMaintenance = (machineId, horizonKey) => MaintenanceServiceImpl.generateCombinedMaintenance(machineId, horizonKey)
export const generateMaintenanceInsights = (machineId, horizonKey) => MaintenanceServiceImpl.generateMaintenanceInsights(machineId, horizonKey)
