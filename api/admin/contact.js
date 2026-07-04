/**
 * api/admin/contact.js
 *
 * GET  /api/admin/contact           → historique de toutes les prises de contact
 * POST /api/admin/contact
 *   action: 'mark_treated'   → { contactId, treated: true|false }
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const messages = await prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
      })
      return res.status(200).json({ messages })
    } catch (err) {
      console.error('[admin/contact GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, contactId, treated } = req.body || {}
  const cid = parseInt(contactId, 10)

  if (action === 'mark_treated') {
    if (isNaN(cid)) return res.status(400).json({ error: 'contactId invalide.' })
    try {
      const updated = await prisma.contactMessage.update({
        where: { id: cid },
        data: { treated: !!treated },
      })
      return res.status(200).json({ ok: true, contact: updated })
    } catch (err) {
      console.error('[admin/contact mark_treated]', err)
      return res.status(500).json({ error: 'Erreur serveur ou message introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
