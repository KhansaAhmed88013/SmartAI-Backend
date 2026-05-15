// Role normalization to support legacy roles while enforcing canonical RBAC
// Canonical roles: SYSTEM_ADMIN, MAINTENANCE_ENGINEER, MACHINE_OPERATOR
// Legacy aliases: ADMIN -> SYSTEM_ADMIN, OPERATOR -> MACHINE_OPERATOR
const normalizeRole = (role) => {
  switch (role) {
    case 'ADMIN':
      return 'SYSTEM_ADMIN'
    case 'OPERATOR':
      return 'MACHINE_OPERATOR'
    default:
      return role
  }
}

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
  const userRole = normalizeRole(req.user.role)
  const allowed = roles.map(normalizeRole)
  if (!allowed.includes(userRole)) return res.status(403).json({ message: 'Forbidden' })
  next()
}

// Backward-compatible single-role guard
export const requireRole = (role) => requireRoles(role)
