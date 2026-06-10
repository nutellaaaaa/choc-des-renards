/**
 * api/notifications.js  (utilisateur connecté)
 *
 * GET /api/notifications           → notifications NON lues de l'utilisateur connecté
 * GET /api/notifications?history=1 → notifications LUES (historique)
 *                                    ← anciennement api/notifications/history.js
 * POST /api/notifications          → { action: 'acknowledge', notificationId }
 *                                    → marquer comme lue + log dans l'historique
 */
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Non authentifié.' }); return null }
  try { return jwt.verify(token, process.env.JWT_SECRET) }
  catch { res.status(401).json({ error: 'Session expirée ou invalide.' }); return null }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = requireAuth(req, res)
  if (!auth) return

  // ── GET : notifications en attente OU historique des notifications lues ─────
  if (req.method === 'GET') {
    try {
      if (req.query.history === '1') {
        // Historique : notifications déjà lues, ordre chronologique inverse
        const notifications = await prisma.notification.findMany({
          where: { userId: auth.userId, read: true },
          orderBy: { readAt: 'desc' },
        })
        return res.status(200).json({ notifications })
      }

      // Non lues (comportement d'origine)
      const notifications = await prisma.notification.findMany({
        where: { userId: auth.userId, read: false },
        orderBy: { createdAt: 'desc' },
      })
      return res.status(200).json({ notifications })
    } catch (err) {
      console.error('[notifications GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, notificationId } = req.body || {}

  if (action === 'acknowledge') {
    const nid = parseInt(notificationId, 10)
    if (isNaN(nid)) return res.status(400).json({ error: 'notificationId invalide.' })

    try {
      const notif = await prisma.notification.findUnique({ where: { id: nid } })
      if (!notif || notif.userId !== auth.userId)
        return res.status(404).json({ error: 'Notification introuvable.' })

      await prisma.notification.update({
        where: { id: nid },
        data: { read: true, readAt: new Date() },
      })

      // Logger dans l'historique de connexion
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { firstName: true, lastName: true, username: true },
      })
      await prisma.loginEvent.create({
        data: {
          userId: auth.userId,
          ip: null,
          userAgent: null,
          success: true,
          message: `${user?.firstName} ${user?.lastName} (@${user?.username}) a pris connaissance de sa notification : "${notif.title}"`,
        },
      })

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[notifications acknowledge]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
