import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import { connectDB } from './config/db.js'
import authRoutes from './routes/auth.js'
import machineRoutes from './routes/machines.js'
import dashboardRoutes from './routes/dashboard.js'
import predictionRoutes from './routes/predictions.js'
import insightsRoutes from './routes/insights.js'
import analyticsRoutes from './routes/analytics.js'
import commandsRoutes from './routes/commands.js'
import usersRoutes from './routes/users.js'
import { startDataGenerator } from './services/dataGenerator.js'
import User from './models/User.js'
import Machine from './models/Machine.js'
import bcrypt from 'bcrypt'

dotenv.config()
const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/machines', machineRoutes)
app.use('/api', dashboardRoutes)
app.use('/api/predictions', predictionRoutes)
app.use('/api/insights', insightsRoutes)
app.use('/api', analyticsRoutes)
app.use('/api/commands', commandsRoutes)
app.use('/api/users', usersRoutes)

const PORT = process.env.PORT || 4000

const init = async () => {
  await connectDB()

  // create default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@smartai.local'
  const admin = await User.findOne({ email: adminEmail })
  if (!admin) {
    const hash = await bcrypt.hash(process.env.ADMIN_PWD || 'adminpass', 10)
    await new User({ name: 'Administrator', email: adminEmail, passwordHash: hash, role: 'SYSTEM_ADMIN' }).save()
    console.log('Created default admin:', adminEmail)
  }

  // start generator
  const interval = parseInt(process.env.DATA_INTERVAL_SECONDS || '5')
  // ensure at least one demo machine exists so generator has data to produce
  const existing = await Machine.findOne()
  if (!existing) {
    const demo = new Machine({
      hardwareId: `HW-${Math.random().toString(36).slice(2, 10)}`,
      machineName: 'Demo Machine 1',
      location: 'Factory Floor A',
      status: 'RUNNING',
      speed: 1000,
      thresholds: {
        temperature: { warning: 75, critical: 80 },
        vibration: { warning: 4.5, critical: 6.0 },
        current: { warning: 55, critical: 60 }
      }
    })
    await demo.save()
    console.log('Seeded demo machine')
  }

  startDataGenerator(interval)

  app.listen(PORT, () => console.log(`SmartAI backend listening on ${PORT}`))
}

init().catch(err => {
  console.error(err)
  process.exit(1)
})
