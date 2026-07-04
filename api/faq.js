// api/faq.js  (utilisateur connecté)
//
// GET  /api/faq                 → liste des sujets FAQ (question + paragraphes),
//                                  ordonnés selon l'ordre choisi par l'admin,
//                                  avec le vote éventuel de l'utilisateur connecté.
// POST /api/faq  { action:'view', topicId }   → enregistre une consultation (+1)
// POST /api/faq  { action:'vote', topicId, useful:true|false } → utile / pas utile
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

  // ── view : consultation d'un sujet (ouverture de l'accordéon) ───────────────
  if (action === 'view') {
    try {
      const topic = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!topic) return res.status(404).json({ error: 'Sujet introuvable.' })

      await prisma.$transaction([
        prisma.faqView.create({ data: { topicId: tid, userId: auth.userId } }),
        prisma.faqTopic.update({ where: { id: tid }, data: { viewCount: { increment: 1 } } }),
      ])

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[faq view]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── vote : utile / pas utile (un seul avis par utilisateur et par sujet) ────
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
