const jwt = require('jsonwebtoken')

/**
 * Vérifie le JWT dans le header Authorization.
 * Retourne le payload décodé si valide et admin, sinon répond avec une erreur.
 *
 * Usage dans une route :
 *   const payload = requireAdmin(req, res)
 *   if (!payload) return  // la réponse d'erreur est déjà envoyée
 */
function requireAdmin(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Non authentifié.' })
    return null
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    const isAdmin =
      payload.role === 'ADMIN' ||
      ['admin', 'root'].includes((payload.username || '').toLowerCase())

    if (!isAdmin) {
      res.status(403).json({ error: 'Accès interdit.' })
      return null
    }

    return payload
  } catch (err) {
    res.status(401).json({ error: 'Session expirée ou invalide.' })
    return null
  }
}

module.exports = { requireAdmin }
