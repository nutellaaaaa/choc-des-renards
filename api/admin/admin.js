/**
 * api/admin.js
 *
 * Fusion des anciennes routes :
 *   api/admin/contact.js
 *   api/admin/faq.js
 *   api/admin/history.js
 *   api/admin/notifications.js
 *   api/admin/phase.js
 *   api/admin/poules.js
 *
 * Routage via ?resource=contact|faq|history|notifications|phase|poules
 * (les rewrites dans vercel.json préservent les anciennes URLs, aucun
 * changement côté frontend n'est nécessaire)
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('./admin/_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

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
    case 'history':
      return handleHistory(req, res)
    case 'notifications':
      return handleNotifications(req, res)
    case 'phase':
      return handlePhase(req, res)
    case 'poules':
      return handlePoules(req, res)
    default:
      return res.status(400).json({ error: 'resource invalide ou manquant.' })
  }
}

/* ============================================================
 * CONTACT — historique des prises de contact (ex admin/contact.js)
 * ============================================================ */
async function handleContact(req, res) {
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

/* ============================================================
 * FAQ — gestion des sujets FAQ (ex admin/faq.js)
 * ============================================================ */
async function handleFaq(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
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

/* ============================================================
 * HISTORY — historique des connexions (ex admin/history.js)
 * ============================================================ */
async function handleHistory(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  const limit = Math.min(parseInt(req.query?.limit || '200', 10), 500)
  const filterUserId = req.query?.userId ? parseInt(req.query.userId, 10) : null

  try {
    const where = filterUserId && !isNaN(filterUserId) ? { userId: filterUserId } : {}

    const events = await prisma.loginEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
    })

    return res.status(200).json({ events })
  } catch (err) {
    console.error('[admin/history]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * NOTIFICATIONS (admin) — envoi / suppression (ex admin/notifications.js)
 * ============================================================ */
async function handleNotifications(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

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

  if (action === 'send') {
    const { userId, userIds, title, message } = req.body
    if (!title || !message)
      return res.status(400).json({ error: 'title et message requis.' })

    let targetIds = []
    if (Array.isArray(userIds) && userIds.length > 0) {
      targetIds = userIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
    } else if (userId) {
      const uid = parseInt(userId, 10)
      if (!isNaN(uid)) targetIds = [uid]
    }

    if (targetIds.length === 0)
      return res.status(400).json({ error: 'Au moins un joueur requis.' })

    try {
      const created = []
      for (const uid of targetIds) {
        const user = await prisma.user.findUnique({ where: { id: uid } })
        if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase())) continue
        const notif = await prisma.notification.create({
          data: { userId: uid, type: 'message', title: title.trim(), message: message.trim() },
        })
        created.push(notif)
      }
      return res.status(201).json({ ok: true, count: created.length, notifications: created })
    } catch (err) {
      console.error('[admin/notifications send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

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

/* ============================================================
 * PHASE — état du tournoi (ex admin/phase.js) — GET public, POST admin
 * ============================================================ */
async function handlePhase(req, res) {
  if (req.method === 'GET') {
    try {
      const state = await prisma.tournamentState.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, currentPhase: 'PHASE0', currentRound: null },
      })
      return res.status(200).json({
        phase: state.currentPhase,
        round: state.currentRound,
        rankingSnapshot: state.rankingSnapshot ? true : false,
        siteSuspended: state.siteSuspended,
      })
    } catch (err) {
      console.error('[admin/phase GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  const payload = requireAdmin(req, res)
  if (!payload) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { phase, round } = req.body || {}

  const validPhases = ['PHASE0', 'PHASE1', 'PHASE2']
  if (!phase || !validPhases.includes(phase)) {
    return res.status(400).json({ error: 'Phase invalide. Valeurs : PHASE0, PHASE1, PHASE2.' })
  }

  if (phase === 'PHASE2') {
    const r = parseInt(round, 10)
    if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2 (entier ≥ 1).' })
  }

  try {
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {
        currentPhase: phase,
        currentRound: phase === 'PHASE2' ? parseInt(round, 10) : null,
      },
      create: {
        id: 1,
        currentPhase: phase,
        currentRound: phase === 'PHASE2' ? parseInt(round, 10) : null,
      },
    })
    return res.status(200).json({ ok: true, phase: state.currentPhase, round: state.currentRound })
  } catch (err) {
    console.error('[admin/phase POST]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * POULES — gestion des poules et groupes Phase 2 (ex admin/poules.js)
 * ============================================================ */
async function handlePoules(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [poules, groups, allUsers] = await Promise.all([
        prisma.poule.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.phase2Group.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true },
          orderBy: { lastName: 'asc' },
        }),
      ])

      const inPoule = new Set(poules.flatMap(p => p.members.map(m => m.userId)))
      const unassigned = allUsers.filter(u => !inPoule.has(u.id))

      const inGroup = new Set(groups.flatMap(g => g.members.map(m => m.userId)))
      const unassignedGroups = allUsers.filter(u => !inGroup.has(u.id))

      return res.status(200).json({ poules, groups, unassigned, unassignedGroups, allUsers })
    } catch (err) {
      console.error('[admin/poules GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'create_poule') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const poule = await prisma.poule.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, poule })
    } catch (err) {
      console.error('[create_poule]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_poule') {
    const { pouleId, name } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid) || !name?.trim()) return res.status(400).json({ error: 'pouleId et name requis.' })
    try {
      const poule = await prisma.poule.update({ where: { id: pid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, poule })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_poule') {
    const { pouleId } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid)) return res.status(400).json({ error: 'pouleId invalide.' })
    try {
      await prisma.poule.delete({ where: { id: pid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'pouleId et userId invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })
    if (!user.active)
      return res.status(403).json({ error: 'Ce joueur est inactif et ne peut pas être ajouté à une poule.' })

    try {
      await prisma.pouleMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.pouleMember.create({ data: { pouleId: pid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      console.error('[add_member]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.pouleMember.deleteMany({ where: { pouleId: pid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'fill_random') {
    const { pouleId, count } = req.body
    const pid = parseInt(pouleId, 10), cnt = parseInt(count, 10)
    if (isNaN(pid) || isNaN(cnt) || cnt < 1) return res.status(400).json({ error: 'Paramètres invalides.' })

    try {
      const allAssigned = await prisma.pouleMember.findMany({ select: { userId: true } })
      const assignedIds = new Set(allAssigned.map(m => m.userId))
      const eligible = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
        select: { id: true },
      })
      const pool = eligible.filter(u => !assignedIds.has(u.id))

      if (pool.length === 0) return res.status(400).json({ error: 'Aucun joueur disponible.' })

      const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, cnt)
      await prisma.pouleMember.createMany({
        data: shuffled.map(u => ({ pouleId: pid, userId: u.id })),
        skipDuplicates: true,
      })
      return res.status(200).json({ ok: true, added: shuffled.length })
    } catch (err) {
      console.error('[fill_random]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'create_group') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const group = await prisma.phase2Group.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_group') {
    const { groupId, name } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid) || !name?.trim()) return res.status(400).json({ error: 'groupId et name requis.' })
    try {
      const group = await prisma.phase2Group.update({ where: { id: gid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_group') {
    const { groupId } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid)) return res.status(400).json({ error: 'groupId invalide.' })
    try {
      await prisma.phase2Group.delete({ where: { id: gid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })
    if (!user.active)
      return res.status(403).json({ error: 'Ce joueur est inactif et ne peut pas être ajouté à un groupe.' })

    try {
      await prisma.phase2GroupMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.phase2GroupMember.create({ data: { groupId: gid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.phase2GroupMember.deleteMany({ where: { groupId: gid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
