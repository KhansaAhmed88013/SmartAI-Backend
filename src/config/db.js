import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

let mongoMemoryServer = null

export const connectDB = async () => {
  const env = (k, def = '') => String(process.env[k] ?? def).replace(/['"]/g, '')
  const uri = env('MONGO_URI', '')
  const demo = env('DEMO', 'false').toLowerCase() === 'true'
  const preferMemory = env('MONGO_MEMORY', 'false').toLowerCase() === 'true'

  const tryConnect = async (connectionUri) => {
    await mongoose.connect(connectionUri, { autoIndex: true })
    console.log('MongoDB connected:', connectionUri)
  }

  const startMemory = async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    mongoMemoryServer = await MongoMemoryServer.create()
    const memUri = mongoMemoryServer.getUri('smartai')
    await tryConnect(memUri)
    console.log('Using in-memory MongoDB (demo mode)')
  }

  // If asked to use memory explicitly, do it first
  if (preferMemory) {
    await startMemory()
    return
  }

  // If a URI is provided, attempt to connect
  if (uri) {
    try {
      await tryConnect(uri)
      return
    } catch (err) {
      console.error('Failed to connect to MongoDB at MONGO_URI:', err?.message || err)
      if (!demo) throw err
      console.log('Falling back to in-memory MongoDB (DEMO=true)')
      await startMemory()
      return
    }
  }

  // No URI provided; in demo we use memory, otherwise default to localhost
  if (demo) {
    await startMemory()
    return
  }

  const defaultUri = 'mongodb://127.0.0.1:27017/smartai'
  await tryConnect(defaultUri)
}
