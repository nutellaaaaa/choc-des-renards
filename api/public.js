/**
 * api/public.js
 *
 * Fusion des anciennes routes (utilisateur connecté, non-admin) :
 *   api/contact.js
 *   api/faq.js
 *   api/notifications.js
 *
 * Routage via ?resource=contact|faq|notifications
 * (les rewrites dans vercel.json préservent les anciennes URLs)
 */
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const VALID_NATURES = [
  "Informer d'un score",
  'Signaler un comportement inapproprié',
  'Poser une question',
  'Proposer une fonctionnalité sur le site',
  "Proposer une idée sur l'organisation du tournoi",
  'Signaler un bug sur le site',
  'Autre',
]

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

  const { resource } = req.query || {}

  switch (resource) {
    case 'contact':
      return handleContact(req, res)
    case 'faq':
      return handleFaq(req, res)
    case 'notifications':
      return handleNotifications(req, res)
    default:
      return res.status(400).json({ error: 'resource invalide ou manquant.' })
  }
}

/* ============================================================
 * CONTACT — envoi d'une prise de contact (ex api/contact.js)
 * ============================================================ */
async function handleContact(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { nature, subject, message } = req.body || {}

  if (!nature || !VALID_NATURES.includes(nature)) {
    return res.status(400).json({ error: 'Nature de la demande invalide.' })
  }
  if (!subject?.trim()) return res.status(400).json({ error: 'L\'objet est requis.' })
  if (!message?.trim()) return res.status(400).json({ error: 'Le message est requis.' })

  try {
    const contact = await prisma.contactMessage.create({
      data: {
        userId: auth.userId,
        nature,
        subject: subject.trim(),
        message: message.trim(),
      },
    })
    return res.status(201).json({ ok: true, contact })
  } catch (err) {
    console.error('[contact]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * FAQ — consultation / vote (ex api/faq.js)
 * ============================================================ */
async function handleFaq(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    try {
      const topics = await prisma.faqTopic.findMany({
        orderBy: { order: 'asc' },
        include: {
          items: { orderBy: { order: 'asc' } },
          votes: { where: { userId: auth.userId }, select: { useful: true } },
        },
      })

      const result = topics.map(t => ({
        id: t.id,
        question: t.question,
        items: t.items.map(i => ({ id: i.id, subtitle: i.subtitle, content: i.content })),
        userVote: t.votes.length > 0 ? t.votes[0].useful : null,
      }))

      return res.status(200).json({ topics: result })
    } catch (err) {
      console.error('[faq GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, topicId } = req.body || {}
  const tid = parseInt(topicId, 10)
  if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })

  if (action === 'view') {
    try {
      const topic = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!topic) return res.status(404).json({ error: 'Sujet introuvable.' })

      const alreadyViewed = await prisma.faqView.findFirst({
        where: { topicId: tid, userId: auth.userId },
      })

      await prisma.faqView.create({ data: { topicId: tid, userId: auth.userId } })
      if (!alreadyViewed) {
        await prisma.faqTopic.update({ where: { id: tid }, data: { viewCount: { increment: 1 } } })
      }

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[faq view]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'vote') {
    const { useful } = req.body || {}
    if (typeof useful !== 'boolean') return res.status(400).json({ error: 'useful (booléen) requis.' })

    try {
      const topic = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!topic) return res.status(404).json({ error: 'Sujet introuvable.' })

      const existing = await prisma.faqVote.findUnique({
        where: { topicId_userId: { topicId: tid, userId: auth.userId } },
      })
      if (existing) {
        return res.status(409).json({ error: 'Vous avez déjà donné votre avis sur ce sujet.' })
      }

      await prisma.$transaction([
        prisma.faqVote.create({ data: { topicId: tid, userId: auth.userId, useful } }),
        prisma.faqTopic.update({
          where: { id: tid },
          data: useful ? { usefulCount: { increment: 1 } } : { notUsefulCount: { increment: 1 } },
        }),
      ])

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[faq vote]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * NOTIFICATIONS (utilisateur) — lecture / acquittement (ex api/notifications.js)
 * ============================================================ */
async function handleNotifications(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    try {
      if (req.query.history === '1') {
        const notifications = await prisma.notification.findMany({
          where: { userId: auth.userId, read: true },
          orderBy: { readAt: 'desc' },
        })
        return res.status(200).json({ notifications })
      }

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
