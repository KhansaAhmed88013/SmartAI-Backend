import { MaintenanceService } from './maintenanceService.js'

/**
 * DEPRECATED: This service has been merged into MaintenanceService.
 * This file is maintained for backward compatibility only.
 * New code should import directly from maintenanceService.js
 */
class InsightServiceImpl {
  // Deprecated: Use MaintenanceService.generateMaintenanceInsights() instead
  static async generateMaintenanceInsights(machineId, horizonKey = '1h') {
    return MaintenanceService.generateMaintenanceInsights(machineId, horizonKey)
  }

  // Deprecated: Legacy method kept for backward compatibility
  static async generateInsights(machineId, horizonKey = '1h') {
    // This was the old threshold-based insight generation
    // Now delegates to maintenance service for UI formatting
    return this.generateMaintenanceInsights(machineId, horizonKey)
  }
}

export const InsightService = InsightServiceImpl
export const generateInsights = (machineId, horizonKey) => InsightServiceImpl.generateInsights(machineId, horizonKey)
export const generateMaintenanceInsights = (machineId, horizonKey) => InsightServiceImpl.generateMaintenanceInsights(machineId, horizonKey)
