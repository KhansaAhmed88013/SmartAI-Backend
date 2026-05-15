import Machine from '../models/Machine.js'
import { receiveSensorData } from './machineDataIngestionService.js'

const rand = (base, variance) => base + (Math.random() - 0.5) * base * variance

export const startDataGenerator = async (intervalSeconds = 5) => {
  let machines = await Machine.find()
  if (!machines || machines.length === 0) {
    const hw = `HW-${Math.random().toString(36).slice(2, 10)}`
    await new Machine({ hardwareId: hw, machineName: `Pending-${hw.slice(3, 9)}`, status: 'PENDING', speed: 800 }).save()
    machines = await Machine.find()
  }

  setInterval(async () => {
    const machines = await Machine.find()

    if (Math.random() < 0.05) {
      const hw = `HW-${Math.random().toString(36).slice(2, 10)}`
      const exists = await Machine.findOne({ hardwareId: hw })
      if (!exists) {
        await new Machine({ hardwareId: hw, machineName: `Pending-${hw.slice(3, 9)}`, status: 'PENDING', speed: 800 }).save()
        console.log(`Registered new pending machine with hardwareId ${hw}`)
      }
    }

    for (const m of machines) {
      const speedFactor = Math.max(0.1, m.speed / 1000)
      let temp = rand(60 * speedFactor, 0.05) + (Math.sin(Date.now() / 60000) * 2)
      let vib = rand(3 * speedFactor, 0.1) + (Math.random() < 0.02 ? 3 : 0)
      let curr = rand(40 * speedFactor, 0.08)

      if (Math.random() < 0.02) temp *= 1.4

      if (m.status === 'STOPPED') {
        temp = temp * 0.2
        vib = vib * 0.1
        curr = 0
      }

      const payload = {
        machineId: m._id,
        temperature: Math.round(temp * 10) / 10,
        vibration: Math.round(vib * 100) / 100,
        current: Math.round(curr * 10) / 10,
        timestamp: new Date()
      }

      const doc = await receiveSensorData(m._id, payload)
      console.log(`SensorData saved for machine ${m.machineName || m._id}: temp=${doc.temperature}, vib=${doc.vibration}, curr=${doc.current}`)
    }
  }, intervalSeconds * 1000)
}
