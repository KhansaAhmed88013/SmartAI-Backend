import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

export const authenticate = (req, res, next) => {
  const header = req.headers.authorization
  if (header) {
    const token = header.replace('Bearer ', '')
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret')
      req.user = payload
      return next()
    } catch (err) {
      return res.status(401).json({ message: 'Invalid token' })
    }
  }

  // Fallback: Demo mode attaches a demo user only when no token provided
  const demoEnv = process.env.DEMO ? String(process.env.DEMO).toLowerCase().replace(/['"]/g, '') : ''
  if (demoEnv === 'true') {
    req.user = { id: 'demo', role: 'SYSTEM_ADMIN', email: 'demo@smartai.local' }
    return next()
  }

  return res.status(401).json({ message: 'Missing Authorization' })
}
