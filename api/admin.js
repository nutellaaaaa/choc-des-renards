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
 *   api/admin/action.js
 *   api/admin/match.js
 *
 * Routage via ?resource=contact|faq|history|notifications|phase|poules|action|match
 * (les rewrites dans vercel.json préservent les anciennes URLs, aucun
 * changement côté frontend n'est nécessaire)
 *
 * IMPORTANT : ce fichier doit être placé en api/admin.js (à la racine du
 * dossier api/, PAS dans un sous-dossier api/admin/), sinon Vercel le
 * route vers /api/admin/admin au lieu de /api/admin.
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('./_auth')
const cheerio = require('cheerio')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']
const VALID_CATEGORIES = ['N', 'R', 'D', 'P', 'NC']
const MYFFBAD_BASE = 'https://myffbad.fr/recherche/joueur?league=12&committee=67&club=2359&isFirstLoad=false'

// Format d'un hash Argon2 encodé (ex: $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>)
const ARGON2_HASH_REGEX = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/

const MALUS_LIST = [
  'Interdiction de smasher ou de tendre droit',
  'Porter un cache-œil',
  'Interdiction de taper le volant au-dessus de la bande',
  'Jouer en demi-terrain pour le joueur le moins bien classé (le demi-terrain change selon le service en cours)',
  'Jouer avec une raquette courte',
  'Jouer avec une raquette lestée',
  'Jouer avec une raquette de précision',
  'Jouer avec un bras dans le dos constamment',
  'Interdiction de faire un coup droit',
  'Interdiction de faire un revers',
  'Annoncer chaque coup à voix haute avant de le jouer',
  'Les couloirs font partie du terrain du joueur le plus classé',
  'Les points du joueur le moins classé comptent double',
  'Le point est marqué par le joueur le mieux classé uniquement s\'il touche le sol avant la raquette de l\'adversaire',
  'Le joueur le moins classé marque le point',
  'Zone restrictive changeant à chaque set : rivière, box, couloir du fond, box puis rivière',
]

function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0
  for (const m of matches) {
    const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
    const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++; if (pw > ow) wins++; else losses++
    setDiff += pw - ow
  }
  return { played, wins, losses, setDiff, points: wins * 3 + losses }
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.played !== b.played) return a.played - b.played
    if (b.points !== a.points) return b.points - a.points
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
}

// Normalise une chaîne pour comparaison de noms (minuscule, sans accents, sans espaces/ponctuation)
function normName(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

// Scrape toutes les pages du club sur MYFFBAD et renvoie { scraped, logs }
async function scrapeMyffbadClub() {
  const logs = []
  const scraped = []
  const MAX_PAGES = 15

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${MYFFBAD_BASE}&page=${page}`
    let html
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CDR-bot/1.0)' },
      })
      if (!r.ok) {
        logs.push({ ok: false, message: `Page ${page} : échec HTTP ${r.status}.` })
        break
      }
      html = await r.text()
    } catch (e) {
      logs.push({ ok: false, message: `Page ${page} : erreur réseau (${e.message}).` })
      break
    }

    const $ = cheerio.load(html)
    const rows = $('table tbody tr')
    if (rows.length === 0) {
      logs.push({ ok: true, message: `Page ${page} : aucune ligne — fin de la pagination.` })
      break
    }

    let countOnPage = 0
    rows.each((i, tr) => {
      const tds = $(tr).find('td')
      if (tds.length < 5) return
      const fullName = $(tds[0]).text().trim().replace(/\s+/g, ' ')
      if (!fullName) return
      const sdmText = $(tds[4]).text().trim()
      const tokens = sdmText.split(/\s+/).filter(Boolean)
      const simpleToken = tokens[0] || ''
      scraped.push({ fullName, simpleToken })
      countOnPage++
    })
    logs.push({ ok: true, message: `Page ${page} : ${countOnPage} joueur(s) récupéré(s).` })

    if (countOnPage === 0) break
  }

  return { scraped, logs }
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
    case 'history':
      return handleHistory(req, res)
    case 'notifications':
      return handleNotifications(req, res)
    case 'phase':
      return handlePhase(req, res)
    case 'poules':
      return handlePoules(req, res)
    case 'action':
      return handleAction(req, res)
    case 'match':
      return handleMatch(req, res)
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

/* ============================================================
 * ACTION — gestion des utilisateurs + actions globales (ex admin/action.js)
 * ============================================================ */
async function handleAction(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      if (req.query.refused === '1') {
        const refused = await prisma.refusedRegistration.findMany({
          orderBy: { refusedAt: 'desc' },
        })
        return res.status(200).json({ refused })
      }

      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, firstName: true, lastName: true,
          phone: true, category: true, role: true,
          accepted: true, banned: true, active: true, createdAt: true,
        },
      })
      return res.status(200).json({ users })
    } catch (err) {
      console.error('[admin/action GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, userId, data } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action requis.' })

  const globalActions = [
    'suspend_site', 'unsuspend_site', 'force_logout_all',
    'reset_all_matches', 'reset_all_notifications', 'deactivate_all_players',
    'scrape_myffbad', 'apply_myffbad_changes',
  ]

  if (globalActions.includes(action)) {
    try {
      switch (action) {
        case 'suspend_site': {
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { siteSuspended: true },
            create: { id: 1, currentPhase: 'PHASE0', siteSuspended: true },
          })
          await prisma.user.updateMany({
            where: { role: 'USER', banned: false },
            data: { forceLogout: true },
          })
          return res.status(200).json({ ok: true, message: 'Site suspendu. Tous les joueurs ont été déconnectés.' })
        }

        case 'unsuspend_site': {
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { siteSuspended: false },
            create: { id: 1, currentPhase: 'PHASE0', siteSuspended: false },
          })
          return res.status(200).json({ ok: true, message: 'Site réactivé.' })
        }

        case 'force_logout_all': {
          await prisma.user.updateMany({
            where: { role: 'USER' },
            data: { forceLogout: true },
          })
          return res.status(200).json({ ok: true, message: 'Déconnexion forcée pour tous les joueurs.' })
        }

        case 'reset_all_matches': {
          await prisma.matchSet.deleteMany({})
          await prisma.match.deleteMany({})
          await prisma.pouleMember.deleteMany({})
          await prisma.poule.deleteMany({})
          await prisma.phase2GroupMember.deleteMany({})
          await prisma.phase2Group.deleteMany({})
          await prisma.specialMatch.deleteMany({})
          await prisma.plannedMatch.deleteMany({})
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { rankingSnapshot: null, currentPhase: 'PHASE0', currentRound: null },
            create: { id: 1, currentPhase: 'PHASE0' },
          })
          return res.status(200).json({ ok: true, message: 'Tous les matchs, scores, poules et groupes ont été supprimés. Tournoi réinitialisé.' })
        }

        case 'reset_all_notifications': {
          await prisma.notification.deleteMany({})
          return res.status(200).json({ ok: true, message: 'Toutes les notifications ont été supprimées.' })
        }

        case 'deactivate_all_players': {
          await prisma.user.updateMany({
            where: { role: 'USER', username: { notIn: ADMIN_USERNAMES } },
            data: { active: false },
          })
          return res.status(200).json({ ok: true, message: 'Tous les joueurs ont été mis en inactif.' })
        }

        case 'scrape_myffbad': {
          const { scraped, logs } = await scrapeMyffbadClub()

          logs.push({ ok: true, message: `── Total récupéré sur MYFFBAD : ${scraped.length} joueur(s). ──` })

          const users = await prisma.user.findMany({
            where: { username: { notIn: ADMIN_USERNAMES } },
            select: { id: true, firstName: true, lastName: true, category: true, username: true },
          })

          const normedScraped = scraped.map(s => ({ ...s, norm: normName(s.fullName) }))

          const results = []
          for (const u of users) {
            const displayName = `${u.firstName} ${u.lastName}`
            const key1 = normName(u.firstName + u.lastName)
            const key2 = normName(u.lastName + u.firstName)
            const match = normedScraped.find(s => s.norm === key1 || s.norm === key2)

            if (!match) {
              results.push({
                userId: u.id, name: displayName, found: false, changed: false,
                message: `${displayName} : non trouvé sur MYFFBAD.`,
              })
              continue
            }

            const m = match.simpleToken.match(/^([A-Z]+)/)
            const letter = m ? m[1] : null

            if (!letter || !VALID_CATEGORIES.includes(letter)) {
              results.push({
                userId: u.id, name: displayName, found: true, changed: false,
                message: `${displayName} : classement simple non disponible (« ${match.simpleToken || '—'} »), catégorie inchangée.`,
              })
              continue
            }

            if (letter === u.category) {
              results.push({
                userId: u.id, name: displayName, found: true, changed: false,
                message: `${displayName} : classement inchangé (${letter}).`,
              })
            } else {
              results.push({
                userId: u.id, name: displayName, found: true, changed: true,
                from: u.category, to: letter,
                message: `${displayName} : classement ${u.category} → ${letter} (en attente de confirmation).`,
              })
            }
          }

          const changedCount = results.filter(r => r.changed).length
          const notFoundCount = results.filter(r => !r.found).length

          return res.status(200).json({
            ok: true,
            logs,
            results,
            totalScraped: scraped.length,
            changedCount,
            notFoundCount,
            message: `Comparaison MYFFBAD terminée : ${changedCount} changement(s) proposé(s), ${notFoundCount} joueur(s) non trouvé(s).`,
          })
        }

        case 'apply_myffbad_changes': {
          const { changes } = req.body || {}
          if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({ error: 'Aucune modification à appliquer.' })
          }

          const applied = []
          for (const c of changes) {
            const uid = parseInt(c?.userId, 10)
            const category = c?.category
            if (isNaN(uid) || !VALID_CATEGORIES.includes(category)) continue

            const u = await prisma.user.findUnique({ where: { id: uid } })
            if (!u || ADMIN_USERNAMES.includes(u.username.toLowerCase())) continue

            await prisma.user.update({ where: { id: uid }, data: { category } })
            applied.push({ userId: uid, name: `${u.firstName} ${u.lastName}`, category })
          }

          return res.status(200).json({
            ok: true,
            appliedCount: applied.length,
            applied,
            message: `${applied.length} classement(s) mis à jour.`,
          })
        }
      }
    } catch (err) {
      console.error('[admin/action global]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (!userId) return res.status(400).json({ error: 'userId requis pour cette action.' })

  const id = parseInt(userId, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'userId invalide.' })

  try {
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' })

    if (ADMIN_USERNAMES.includes(user.username.toLowerCase())) {
      return res.status(403).json({ error: 'Ce compte ne peut pas être modifié.' })
    }

    switch (action) {
      case 'accept': {
        await prisma.user.update({ where: { id }, data: { accepted: true, banned: false } })
        return res.status(200).json({ ok: true, message: 'Utilisateur accepté.' })
      }

      case 'refuse': {
        await prisma.refusedRegistration.create({
          data: {
            firstName: user.firstName,
            lastName:  user.lastName,
            phone:     user.phone,
          },
        })
        await prisma.user.delete({ where: { id } })
        return res.status(200).json({ ok: true, message: 'Demande refusée, compte supprimé.' })
      }

      case 'ban': {
        await prisma.user.update({ where: { id }, data: { banned: true, accepted: false, forceLogout: true } })
        return res.status(200).json({ ok: true, message: 'Utilisateur banni et déconnecté.' })
      }

      case 'unban': {
        await prisma.user.update({ where: { id }, data: { banned: false, accepted: true, forceLogout: false } })
        return res.status(200).json({ ok: true, message: 'Bannissement levé.' })
      }

      case 'delete_banned': {
        if (!user.banned) return res.status(400).json({ error: 'Cet utilisateur n\'est pas banni.' })
        await prisma.user.delete({ where: { id } })
        return res.status(200).json({ ok: true, message: 'Utilisateur banni supprimé définitivement.' })
      }

      case 'activate': {
        await prisma.user.update({ where: { id }, data: { active: true } })
        return res.status(200).json({ ok: true, message: 'Utilisateur activé.' })
      }

      case 'deactivate': {
        await prisma.user.update({ where: { id }, data: { active: false } })
        return res.status(200).json({ ok: true, message: 'Utilisateur désactivé.' })
      }

      // ── reset_password : remplace le mot de passe par un hash déjà calculé
      // par le joueur (l'admin n'a jamais connaissance du mot de passe en clair) ──
      case 'reset_password': {
        const { newPasswordHash } = req.body || {}
        if (!newPasswordHash || typeof newPasswordHash !== 'string')
          return res.status(400).json({ error: 'newPasswordHash requis.' })

        const hash = newPasswordHash.trim()
        if (hash.length > 200 || !ARGON2_HASH_REGEX.test(hash)) {
          return res.status(400).json({
            error: 'Format de hash invalide. Le hash doit être un hash Argon2 encodé complet (commence par $argon2id$, $argon2i$ ou $argon2d$).',
          })
        }

        await prisma.user.update({
          where: { id },
          data: { passwordHash: hash, forceLogout: true },
        })
        return res.status(200).json({
          ok: true,
          message: 'Mot de passe remplacé. Le joueur a été déconnecté de toutes ses sessions actives.',
        })
      }

      case 'update': {
        if (!data) return res.status(400).json({ error: 'Données de mise à jour manquantes.' })
        const { firstName, lastName, username, phone, category } = data
        if (category && !VALID_CATEGORIES.includes(category))
          return res.status(400).json({ error: 'Catégorie invalide.' })
        if (username && username !== user.username) {
          if (ADMIN_USERNAMES.includes(username.toLowerCase()))
            return res.status(400).json({ error: 'Ce pseudo est réservé.' })
          const existing = await prisma.user.findUnique({ where: { username } })
          if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' })
        }
        const updateData = {}
        if (firstName) updateData.firstName = firstName
        if (lastName)  updateData.lastName  = lastName
        if (username)  updateData.username  = username
        if (phone)     updateData.phone     = phone
        if (category)  updateData.category  = category
        const updated = await prisma.user.update({
          where: { id }, data: updateData,
          select: {
            id: true, username: true, firstName: true, lastName: true,
            phone: true, category: true, role: true,
            accepted: true, banned: true, active: true, createdAt: true,
          },
        })
        return res.status(200).json({ ok: true, user: updated })
      }

      default:
        return res.status(400).json({ error: `Action inconnue : ${action}` })
    }
  } catch (err) {
    console.error('[admin/action]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * MATCH — gestion des matchs, planifications, photos (ex admin/match.js)
 * ============================================================ */
async function handleMatch(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [pending, published, activeUsers, openSpecials, planned] = await Promise.all([
        prisma.match.findMany({
          where: { published: false },
          orderBy: { createdAt: 'desc' },
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            photos: { orderBy: { createdAt: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.match.findMany({
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          take: 200,
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            photos: { orderBy: { createdAt: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true },
          orderBy: { lastName: 'asc' },
        }),
        prisma.specialMatch.findMany({
          where: { resolved: false },
          orderBy: { createdAt: 'desc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.plannedMatch.findMany({
          orderBy: { scheduledDate: 'asc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true, phone: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true, phone: true } },
          },
        }),
      ])
      return res.status(200).json({ pending, published, activeUsers, openSpecials, planned, malusList: MALUS_LIST })
    } catch (err) {
      console.error('[admin/match GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'publish') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.update({ where: { id: mid }, data: { published: true } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'publish_all') {
    try {
      const { count } = await prisma.match.updateMany({ where: { published: false }, data: { published: true } })
      return res.status(200).json({ ok: true, count })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'edit') {
    const { matchId, matchDate, opponentFirstName, opponentLastName, note, sets } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!sets || !Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    try {
      await prisma.matchSet.deleteMany({ where: { matchId: mid } })
      const updated = await prisma.match.update({
        where: { id: mid },
        data: {
          matchDate: matchDate ? new Date(matchDate) : undefined,
          opponentFirstName: opponentFirstName ? opponentFirstName.trim() : undefined,
          opponentLastName:  opponentLastName  ? opponentLastName.trim()  : undefined,
          note: note !== undefined ? (note ? note.trim() : null) : undefined,
          sets: {
            create: sets.map(s => ({
              setNumber: s.setNumber,
              playerScore: s.playerScore,
              opponentScore: s.opponentScore,
            })),
          },
        },
        include: { sets: { orderBy: { setNumber: 'asc' } } },
      })
      return res.status(200).json({ ok: true, match: updated })
    } catch (err) {
      console.error('[admin/match edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'refresh_ranking') {
    const freeze = req.body.freeze !== false
    try {
      if (!freeze) {
        await prisma.tournamentState.update({ where: { id: 1 }, data: { rankingSnapshot: null } })
        return res.status(200).json({ ok: true, message: 'Classement remis en live.' })
      }

      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
        select: {
          id: true, username: true, firstName: true, lastName: true, category: true, createdAt: true,
          matches: { where: { published: true }, include: { sets: true } },
          pouleMembers: { select: { pouleId: true } },
        },
      })

      const poules = await prisma.poule.findMany({
        include: { members: { include: { user: { select: { id: true } } } } },
      })
      const phase2Groups = await prisma.phase2Group.findMany({
        include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } } } },
      })

      const userPouleMap = {}
      for (const p of poules) for (const m of p.members) userPouleMap[m.userId] = p.id

      const players = users.map(u => ({
        id: u.id, username: u.username,
        firstName: u.firstName, lastName: u.lastName,
        category: u.category, createdAt: u.createdAt,
        pouleId: userPouleMap[u.id] || null,
        ...computeStats(u.matches),
      }))

      const poulesWithStats = poules.map(p => {
        const memberIds = new Set(p.members.map(m => m.userId))
        const poulePlayers = players.filter(pl => memberIds.has(pl.id))
        return {
          id: p.id, name: p.name, phase: p.phase,
          totalPoints: poulePlayers.reduce((a, pl) => a + pl.points, 0),
          totalWins:   poulePlayers.reduce((a, pl) => a + pl.wins, 0),
          members: sortPlayers(poulePlayers),
        }
      })

      const snapshot = JSON.stringify({ players: sortPlayers(players), poules: poulesWithStats, phase2Groups })
      await prisma.tournamentState.upsert({
        where: { id: 1 }, update: { rankingSnapshot: snapshot },
        create: { id: 1, currentPhase: 'PHASE1', rankingSnapshot: snapshot },
      })
      return res.status(200).json({ ok: true, message: 'Classement figé.' })
    } catch (err) {
      console.error('[admin/match refresh_ranking]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add') {
    const { userId, phase, round, matchDate, opponentId, opponentFirstName, opponentLastName, note, sets } = req.body

    if (!userId || !phase || !matchDate)
      return res.status(400).json({ error: 'Champs requis manquants.' })

    const validPhases = ['PHASE0', 'PHASE1', 'PHASE2']
    if (!validPhases.includes(phase))
      return res.status(400).json({ error: 'Phase invalide.' })

    if (phase === 'PHASE2') {
      const r = parseInt(round, 10)
      if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2.' })
    }

    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

    const player = await prisma.user.findUnique({ where: { id: uid } })
    if (!player || !player.accepted || player.banned)
      return res.status(404).json({ error: 'Joueur introuvable ou inactif.' })
    if (ADMIN_USERNAMES.includes(player.username.toLowerCase()))
      return res.status(403).json({ error: "Impossible d'ajouter un match à un compte admin." })

    let oppFn, oppLn, oppUser = null
    if (opponentId) {
      const oppId = parseInt(opponentId, 10)
      oppUser = await prisma.user.findUnique({ where: { id: oppId } })
      if (!oppUser) return res.status(404).json({ error: 'Adversaire introuvable.' })
      oppFn = oppUser.firstName
      oppLn = oppUser.lastName
    } else {
      if (!opponentFirstName || !opponentLastName)
        return res.status(400).json({ error: 'Adversaire requis (opponentId ou prénom+nom).' })
      oppFn = opponentFirstName.trim()
      oppLn = opponentLastName.trim()
      oppUser = await prisma.user.findFirst({
        where: {
          firstName: { equals: oppFn, mode: 'insensitive' },
          lastName:  { equals: oppLn, mode: 'insensitive' },
          accepted: true, banned: false,
          username: { notIn: ADMIN_USERNAMES },
        },
      })
    }

    try {
      const matchDateObj = new Date(matchDate)
      const roundInt = phase === 'PHASE2' ? parseInt(round, 10) : null

      let specialMatchId = null
      let notInSpecials = false
      const openSpecials = await prisma.specialMatch.findMany({ where: { resolved: false } })

      if (openSpecials.length > 0) {
        const sm = openSpecials.find(s => {
          const i1 = s.player1Id === uid || s.player2Id === uid
          const oppId2 = oppUser?.id
          const i2 = oppId2 && (s.player1Id === oppId2 || s.player2Id === oppId2)
          return i1 && i2
        })
        if (sm) {
          specialMatchId = sm.id
          await prisma.specialMatch.update({ where: { id: sm.id }, data: { resolved: true } })
        } else { notInSpecials = true }
      } else { notInSpecials = true }

      const mainMatch = await prisma.match.create({
        data: {
          userId: uid, phase, roundNumber: roundInt,
          matchDate: matchDateObj,
          opponentFirstName: oppFn, opponentLastName: oppLn,
          note: note ? note.trim() : null,
          published: false, specialMatchId,
          sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
        },
        include: { sets: true },
      })

      let mirrorMatch = null
      if (oppUser && !ADMIN_USERNAMES.includes(oppUser.username.toLowerCase())) {
        mirrorMatch = await prisma.match.create({
          data: {
            userId: oppUser.id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: player.firstName, opponentLastName: player.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        })
      }

      return res.status(201).json({
        ok: true, match: mainMatch, mirrorMatch,
        mirrorCreated: !!mirrorMatch, notInSpecials,
        warning: notInSpecials ? "Ce match n'est pas répertorié dans les rencontres en cours." : null,
      })
    } catch (err) {
      console.error('[admin/match add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_from_special') {
    const { specialMatchId, matchDate, note, sets } = req.body

    const smid = parseInt(specialMatchId, 10)
    if (isNaN(smid)) return res.status(400).json({ error: 'specialMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

    try {
      const sm = await prisma.specialMatch.findUnique({ where: { id: smid } })
      if (!sm) return res.status(404).json({ error: 'Rencontre spéciale introuvable.' })
      if (sm.resolved) return res.status(400).json({ error: 'Cette rencontre est déjà résolue.' })

      const [p1, p2] = await Promise.all([
        prisma.user.findUnique({ where: { id: sm.player1Id } }),
        prisma.user.findUnique({ where: { id: sm.player2Id } }),
      ])
      if (!p1 || !p2) return res.status(404).json({ error: 'Joueur introuvable.' })

      const matchDateObj = new Date(matchDate)
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      const phase = state?.currentPhase || 'PHASE0'
      const roundInt = phase === 'PHASE2' ? state?.currentRound : null

      await prisma.specialMatch.update({ where: { id: smid }, data: { resolved: true } })

      const [m1, m2] = await Promise.all([
        prisma.match.create({
          data: {
            userId: sm.player1Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p2.firstName, opponentLastName: p2.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId: smid,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
          },
          include: { sets: true },
        }),
        prisma.match.create({
          data: {
            userId: sm.player2Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p1.firstName, opponentLastName: p1.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId: smid,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        }),
      ])

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    } catch (err) {
      console.error('[admin/match add_from_special]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.delete({ where: { id: mid } })
      return res.status(200).json({ ok: true, message: 'Match supprimé.' })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'planned_add') {
    const { player1Id, player2Id, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    if (!player1Id || !player2Id) return res.status(400).json({ error: 'Les deux joueurs sont requis.' })
    const p1id = parseInt(player1Id, 10)
    const p2id = parseInt(player2Id, 10)
    if (isNaN(p1id) || isNaN(p2id) || p1id === p2id)
      return res.status(400).json({ error: 'Joueurs invalides.' })
    try {
      const pm = await prisma.plannedMatch.create({
        data: {
          player1Id: p1id,
          player2Id: p2id,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: malus || null,
          malusTarget: malusTarget ? parseInt(malusTarget, 10) : null,
          note: note ? note.trim() : null,
          phase: phase || 'PHASE1',
          roundNumber: phase === 'PHASE2' ? (parseInt(round, 10) || null) : null,
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
        },
      })
      return res.status(201).json({ ok: true, plannedMatch: pm })
    } catch (err) {
      console.error('[planned_add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'planned_edit') {
    const { plannedMatchId, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      const pm = await prisma.plannedMatch.update({
        where: { id: pmid },
        data: {
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: malus || null,
          malusTarget: malusTarget ? parseInt(malusTarget, 10) : null,
          note: note ? note.trim() : null,
          phase: phase || 'PHASE1',
          roundNumber: phase === 'PHASE2' ? (parseInt(round, 10) || null) : null,
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
        },
      })
      return res.status(200).json({ ok: true, plannedMatch: pm })
    } catch (err) {
      console.error('[planned_edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'planned_delete') {
    const pmid = parseInt(req.body.plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      await prisma.plannedMatch.delete({ where: { id: pmid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'planned_convert') {
    const { plannedMatchId, matchDate, note, sets } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

    try {
      const pm = await prisma.plannedMatch.findUnique({
        where: { id: pmid },
        include: {
          player1: true,
          player2: true,
        },
      })
      if (!pm) return res.status(404).json({ error: 'Match planifié introuvable.' })

      const matchDateObj = new Date(matchDate)
      const roundInt = pm.phase === 'PHASE2' ? pm.roundNumber : null

      const noteStr = note ? note.trim() : (pm.note || null)

      const [m1, m2] = await Promise.all([
        prisma.match.create({
          data: {
            userId: pm.player1Id, phase: pm.phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName,
            note: noteStr,
            published: false,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
          },
          include: { sets: true },
        }),
        prisma.match.create({
          data: {
            userId: pm.player2Id, phase: pm.phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName,
            note: noteStr,
            published: false,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        }),
      ])

      await prisma.plannedMatch.delete({ where: { id: pmid } })

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    } catch (err) {
      console.error('[planned_convert]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_photos') {
    const { matchId, photos } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!Array.isArray(photos) || photos.length === 0)
      return res.status(400).json({ error: 'photos requis (array).' })
    try {
      const match = await prisma.match.findUnique({ where: { id: mid } })
      if (!match) return res.status(404).json({ error: 'Match introuvable.' })
      const created = await prisma.matchPhoto.createMany({
        data: photos.map(p => ({
          matchId: mid,
          url: p.url,
          publicId: p.publicId || null,
          caption: p.caption || null,
        })),
      })
      if (req.body.mirrorMatchId) {
        const mmid = parseInt(req.body.mirrorMatchId, 10)
        if (!isNaN(mmid)) {
          await prisma.matchPhoto.createMany({
            data: photos.map(p => ({
              matchId: mmid,
              url: p.url,
              publicId: p.publicId || null,
              caption: p.caption || null,
            })),
          })
        }
      }
      return res.status(201).json({ ok: true, count: created.count })
    } catch (err) {
      console.error('[admin/match add_photos]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_photo') {
    const pid = parseInt(req.body.photoId, 10)
    if (isNaN(pid)) return res.status(400).json({ error: 'photoId invalide.' })
    try {
      await prisma.matchPhoto.delete({ where: { id: pid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou photo introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
