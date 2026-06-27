import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import User from '../models/User.js'

dotenv.config()

const EMAIL_HOST = process.env.EMAIL_HOST
const EMAIL_PORT = Number(process.env.EMAIL_PORT || '587')
const EMAIL_SECURE = String(process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true'
const EMAIL_USER = process.env.EMAIL_USER
const EMAIL_PASS = process.env.EMAIL_PASS
const EMAIL_FROM = process.env.EMAIL_FROM || `SmartAI <no-reply@smartai.local>`

let transporter

const getTransporter = () => {
  if (transporter) return transporter
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    throw new Error('Email transport is not configured: missing EMAIL_HOST, EMAIL_USER, or EMAIL_PASS')
  }
  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  })
  return transporter
}

const formatDateTime = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

const buildSubject = (alert, machine) => {
  const severityLabel = alert.severity === 'HIGH' ? 'Critical' : 'Warning'
  const machineName = machine.machineName || machine.hardwareId || 'Machine'
  return `SmartAI Alert: ${machineName} — ${alert.parameter} ${severityLabel}`
}

const buildHtml = (alert, machine, user) => {
  const machineName = machine.machineName || machine.hardwareId || 'Machine'
  const location = machine.location || 'Unknown location'
  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;">
      <p>Hi ${user.name || 'User'},</p>
      <p>An alert has been generated for <strong>${machineName}</strong> (${location}).</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;margin-top:16px;">
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Parameter</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${alert.parameter}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Severity</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${alert.severity === 'HIGH' ? 'Critical' : 'Warning'}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Value</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${alert.value}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Threshold</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${alert.threshold}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Source</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${alert.source}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;">Time</td>
          <td style="padding:8px;border:1px solid #e2e8f0;">${formatDateTime(alert.timestamp)}</td>
        </tr>
      </table>
      <p style="margin-top:18px;">${alert.message}</p>
      <p style="margin-top:24px;color:#555;font-size:13px;">If you would like to update your alert preference, please log in to your SmartAI account.</p>
    </div>
  `
}

const buildText = (alert, machine, user) => {
  const machineName = machine.machineName || machine.hardwareId || 'Machine'
  const location = machine.location || 'Unknown location'
  return `Hi ${user.name || 'User'},\n\n` +
    `An alert has been generated for ${machineName} (${location}).\n\n` +
    `Parameter: ${alert.parameter}\n` +
    `Severity: ${alert.severity === 'HIGH' ? 'Critical' : 'Warning'}\n` +
    `Value: ${alert.value}\n` +
    `Threshold: ${alert.threshold}\n` +
    `Source: ${alert.source}\n` +
    `Time: ${formatDateTime(alert.timestamp)}\n\n` +
    `${alert.message}\n\n` +
    `Log in to your SmartAI account to review active alerts and update preferences.\n`
}

export const sendAlertEmailToUsers = async (alert, machine) => {
  // DEBUG: log env vars (remove after confirming emails work)
  console.log('[Email] EMAIL_HOST:', EMAIL_HOST)
  console.log('[Email] EMAIL_USER:', EMAIL_USER)
  console.log('[Email] EMAIL_PASS set:', !!EMAIL_PASS)

  const users = await User.find({ 'notifications.email': true }).select('name email').lean()

  // DEBUG: log how many users will receive the email
  console.log('[Email] Users with email notifications enabled:', users?.length ?? 0, users?.map(u => u.email))

  if (!users || users.length === 0) {
    console.warn('[Email] No users found with notifications.email=true — email not sent')
    return null
  }

  const transport = getTransporter()
  const sendPromises = users.map((user) =>
    transport.sendMail({
      from: EMAIL_FROM,
      to: user.email,
      subject: buildSubject(alert, machine),
      text: buildText(alert, machine, user),
      html: buildHtml(alert, machine, user),
    })
  )

  const results = await Promise.allSettled(sendPromises)
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[Email] Sent successfully to ${users[i].email}`)
    } else {
      console.error(`[Email] Failed to send to ${users[i].email}:`, r.reason)
    }
  })
  return results
}