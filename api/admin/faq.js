/**
 * api/admin/faq.js
 *
 * GET  /api/admin/faq                      → liste de tous les sujets FAQ (avec compteurs)
 * GET  /api/admin/faq?history=1&topicId=X  → historique des consultations d'un sujet
 *
 * POST /api/admin/faq
 *   action: 'create'  → { question, items:[{subtitle, content}] }
 *   action: 'update'  → { topicId, question, items:[{subtitle, content}] }
 *   action: 'delete'  → { topicId }
 *   action: 'reorder' → { order: [topicId, topicId, ...] }  (ordre voulu, de haut en bas)
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

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      // Historique des consultations d'un sujet précis
      if (req.query.history === '1') {
        const tid = parseInt(req.query.topicId, 10)
        if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })

        const limit = Math.min(parseInt(req.query.limit || '300', 10), 500)
        const views = await prisma.faqView.findMany({
          where: { topicId: tid },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
        })
        return res.status(200).json({ views })
      }

      const topics = await prisma.faqTopic.findMany({
        orderBy: { order: 'asc' },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ topics })
    } catch (err) {
      console.error('[admin/faq GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  function sanitizeItems(items) {
    if (!Array.isArray(items)) return null
    const cleaned = items
      .map(it => ({
        subtitle: it?.subtitle && String(it.subtitle).trim() ? String(it.subtitle).trim() : null,
        content: it?.content ? String(it.content).trim() : '',
      }))
      .filter(it => it.content.length > 0)
    return cleaned
  }

  // ── create ───────────────────────────────────────────────────────────────────
  if (action === 'create') {
    const { question } = req.body
    const items = sanitizeItems(req.body.items)
    if (!question?.trim()) return res.status(400).json({ error: 'La question (titre) est requise.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const maxOrder = await prisma.faqTopic.aggregate({ _max: { order: true } })
      const topic = await prisma.faqTopic.create({
        data: {
          question: question.trim(),
          order: (maxOrder._max.order ?? -1) + 1,
          items: {
            create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })),
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(201).json({ ok: true, topic })
    } catch (err) {
      console.error('[admin/faq create]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── update ───────────────────────────────────────────────────────────────────
  if (action === 'update') {
    const { topicId, question } = req.body
    const tid = parseInt(topicId, 10)
    const items = sanitizeItems(req.body.items)
    if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })
    if (!question?.trim()) return res.status(400).json({ error: 'La question (titre) est requise.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const existing = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!existing) return res.status(404).json({ error: 'Sujet introuvable.' })

      await prisma.$transaction([
        prisma.faqItem.deleteMany({ where: { topicId: tid } }),
        prisma.faqTopic.update({
          where: { id: tid },
          data: {
            question: question.trim(),
            items: { create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })) },
          },
        }),
      ])

      const topic = await prisma.faqTopic.findUnique({
        where: { id: tid },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ ok: true, topic })
    } catch (err) {
      console.error('[admin/faq update]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── delete ───────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { topicId } = req.body
    const tid = parseInt(topicId, 10)
    if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })
    try {
      await prisma.faqTopic.delete({ where: { id: tid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/faq delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou sujet introuvable.' })
    }
  }

  // ── reorder ──────────────────────────────────────────────────────────────────
  if (action === 'reorder') {
    const { order } = req.body
    if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ error: 'order requis.' })
    try {
      await prisma.$transaction(
        order.map((id, i) => {
          const tid = parseInt(id, 10)
          return prisma.faqTopic.update({ where: { id: tid }, data: { order: i } })
        })
      )
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/faq reorder]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
