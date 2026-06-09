/**
 * api/admin/notifications.js
 *
 * POST /api/admin/notifications
 *   action: 'send'        → envoyer une notification simple à un joueur
 *   action: 'send_special'→ organiser une rencontre spéciale (notifie 2 joueurs + crée SpecialMatch)
 *   action: 'delete'      → supprimer une notification
 *
 * GET /api/admin/notifications
 *   → liste toutes les notifications (avec statut de lecture)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * api/notifications.js (utilisateur connecté)
 *
 * GET /api/notifications        → notifications non lues de l'utilisateur connecté
 * POST /api/notifications       → { action: 'acknowledge', notificationId }
 *   → marquer une notification comme lue (+ log dans l'historique de connexion)
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Non authentifié.' }); return null }
  try { return jwt.verify(token, process.env.JWT_SECRET) }
  catch { res.status(401).json({ error: 'Session expirée ou invalide.' }); return null }
}

// ── Handler admin ─────────────────────────────────────────────────────────────
async function adminHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  // GET : lister toutes les notifications
  if (req.method === 'GET') {
    try {
      const notifications = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
      })
      return res.status(200).json({ notifications })
    } catch (err) {
      console.error('[admin/notifications GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  // ── send : notification simple ──
  if (action === 'send') {
    const { userId, title, message } = req.body
    if (!userId || !title || !message)
      return res.status(400).json({ error: 'userId, title et message requis.' })

    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' })
    if (ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Impossible de notifier un compte admin.' })

    try {
      const notif = await prisma.notification.create({
        data: { userId: uid, type: 'message', title: title.trim(), message: message.trim() },
      })
      return res.status(201).json({ ok: true, notification: notif })
    } catch (err) {
      console.error('[admin/notifications send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── send_special : rencontre spéciale ──
  if (action === 'send_special') {
    const { player1Id, player2Id, startDate, endDate, reason, note, message } = req.body
    if (!player1Id || !player2Id || !startDate || !endDate || !reason)
      return res.status(400).json({ error: 'player1Id, player2Id, startDate, endDate, reason requis.' })

    const p1id = parseInt(player1Id, 10)
    const p2id = parseInt(player2Id, 10)
    if (isNaN(p1id) || isNaN(p2id) || p1id === p2id)
      return res.status(400).json({ error: 'Joueurs invalides ou identiques.' })

    const [p1, p2] = await Promise.all([
      prisma.user.findUnique({ where: { id: p1id } }),
      prisma.user.findUnique({ where: { id: p2id } }),
    ])
    if (!p1 || !p2) return res.status(404).json({ error: 'Un des joueurs est introuvable.' })
    if (ADMIN_USERNAMES.includes(p1.username.toLowerCase()) || ADMIN_USERNAMES.includes(p2.username.toLowerCase()))
      return res.status(403).json({ error: 'Impossible d\'impliquer un compte admin.' })

    try {
      // Créer la rencontre spéciale
      const special = await prisma.specialMatch.create({
        data: {
          player1Id: p1id,
          player2Id: p2id,
          startDate: new Date(startDate),
          endDate:   new Date(endDate),
          reason:    reason.trim(),
          note:      note ? note.trim() : null,
        },
      })

      const customMsg = message ? message.trim() : ''
      const baseTitle = 'Rencontre organisée'
      const baseMsg   = `Vous êtes invité à affronter ${p2.firstName} ${p2.lastName}. À partir du ${new Date(startDate).toLocaleDateString('fr-FR')}, avant le ${new Date(endDate).toLocaleDateString('fr-FR')}. Motif : ${reason.trim()}.${customMsg ? ' ' + customMsg : ''}`
      const baseMsgP2 = `Vous êtes invité à affronter ${p1.firstName} ${p1.lastName}. À partir du ${new Date(startDate).toLocaleDateString('fr-FR')}, avant le ${new Date(endDate).toLocaleDateString('fr-FR')}. Motif : ${reason.trim()}.${customMsg ? ' ' + customMsg : ''}`

      const [n1, n2] = await Promise.all([
        prisma.notification.create({
          data: {
            userId: p1id, type: 'special_match', title: baseTitle,
            message: baseMsg,
            opponentName: `${p2.firstName} ${p2.lastName}`,
            startDate: new Date(startDate), endDate: new Date(endDate),
            reason: reason.trim(),
          },
        }),
        prisma.notification.create({
          data: {
            userId: p2id, type: 'special_match', title: baseTitle,
            message: baseMsgP2,
            opponentName: `${p1.firstName} ${p1.lastName}`,
            startDate: new Date(startDate), endDate: new Date(endDate),
            reason: reason.trim(),
          },
        }),
      ])

      return res.status(201).json({ ok: true, special, notifications: [n1, n2] })
    } catch (err) {
      console.error('[admin/notifications send_special]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── delete ──
  if (action === 'delete') {
    const { notificationId } = req.body
    const nid = parseInt(notificationId, 10)
    if (isNaN(nid)) return res.status(400).json({ error: 'notificationId invalide.' })
    try {
      await prisma.notification.delete({ where: { id: nid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/notifications delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou notification introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

// ── Handler utilisateur ───────────────────────────────────────────────────────
async function userHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = requireAuth(req, res)
  if (!auth) return

  // GET : notifications en attente de l'utilisateur
  if (req.method === 'GET') {
    try {
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
      const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { firstName: true, lastName: true, username: true } })
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

// Export selon le chemin appelé (admin vs user)
module.exports = { adminHandler, userHandler }
