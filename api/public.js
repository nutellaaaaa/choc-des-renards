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
    case 'convocations':
      return handleConvocations(req, res)
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

/* ============================================================
 * CONVOCATIONS — "Score du match" : un joueur convoqué (rencontre
 * spéciale OU match planifié par l'admin) renseigne lui-même le score
 * avant la date limite. Le match apparaît alors automatiquement, non
 * publié, dans la liste des matchs à publier de l'admin.
 * ============================================================ */
async function handleConvocations(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return
  const uid = auth.userId

  if (req.method === 'GET') {
    try {
      const [specials, planned] = await Promise.all([
        prisma.specialMatch.findMany({
          where: { resolved: false, OR: [{ player1Id: uid }, { player2Id: uid }] },
          orderBy: { endDate: 'asc' },
        }),
        prisma.plannedMatch.findMany({
          where: { OR: [{ player1Id: uid }, { player2Id: uid }] },
          orderBy: { scheduledDate: 'asc' },
        }),
      ])

      async function enrich(list, type, deadlineField, deadlineBlocks) {
        return Promise.all(list.map(async (m) => {
          const opponentId = m.player1Id === uid ? m.player2Id : m.player1Id
          const opponent = await prisma.user.findUnique({
            where: { id: opponentId },
            select: { id: true, firstName: true, lastName: true, username: true },
          })
          const deadline = m[deadlineField] || null
          return {
            type,
            id: m.id,
            opponent,
            deadline,
            expired: !!(deadlineBlocks && deadline && new Date(deadline) < new Date()),
            phase: m.phase || null,
            roundNumber: m.roundNumber || null,
            reason: m.reason || null,
            note: m.note || null,
          }
        }))
      }

      // Pour les rencontres spéciales, la date limite (endDate) bloque réellement la saisie.
      // Pour les matchs planifiés, scheduledDate est juste indicative (pas de blocage dur).
      const specialConv = await enrich(specials, 'special', 'endDate', true)
      const plannedConv = await enrich(planned, 'planned', 'scheduledDate', false)

      const convocations = [...specialConv, ...plannedConv].sort((a, b) => {
        if (!a.deadline) return 1
        if (!b.deadline) return -1
        return new Date(a.deadline) - new Date(b.deadline)
      })

      return res.status(200).json({ convocations })
    } catch (err) {
      console.error('[convocations GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}
  if (action !== 'submit') return res.status(400).json({ error: 'Action invalide.' })

  const { convType, convId, matchDate, sets, note } = req.body || {}
  const cid = parseInt(convId, 10)

  if (!['special', 'planned'].includes(convType) || isNaN(cid)) {
    return res.status(400).json({ error: 'Convocation invalide.' })
  }
  if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5) {
    return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
  }
  for (const s of sets) {
    if (typeof s.setNumber !== 'number' || typeof s.playerScore !== 'number' || typeof s.opponentScore !== 'number') {
      return res.status(400).json({ error: 'Scores de sets invalides.' })
    }
  }

  try {
    if (convType === 'special') {
      const sm = await prisma.specialMatch.findUnique({ where: { id: cid } })
      if (!sm) return res.status(404).json({ error: 'Convocation introuvable.' })
      if (sm.player1Id !== uid && sm.player2Id !== uid)
        return res.status(403).json({ error: 'Ce match ne vous concerne pas.' })
      if (sm.resolved)
        return res.status(409).json({ error: 'Le score de ce match a déjà été renseigné.' })
      if (sm.endDate && new Date(sm.endDate) < new Date())
        return res.status(410).json({ error: 'La date limite pour renseigner ce score est dépassée. Contactez l\'administrateur.' })

      const [p1, p2] = await Promise.all([
        prisma.user.findUnique({ where: { id: sm.player1Id } }),
        prisma.user.findUnique({ where: { id: sm.player2Id } }),
      ])
      if (!p1 || !p2) return res.status(404).json({ error: 'Joueur introuvable.' })

      const matchDateObj = matchDate ? new Date(matchDate) : new Date()
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      const phase = state?.currentPhase || 'PHASE0'
      const roundInt = phase === 'PHASE2' ? state?.currentRound : null
      const noteStr = note ? note.trim() : null

      // Le joueur qui saisit le score renseigne toujours playerScore/opponentScore
      // depuis SON point de vue → on inverse pour le match miroir de l'adversaire.
      const scorerIsP1 = sm.player1Id === uid

      await prisma.specialMatch.update({ where: { id: cid }, data: { resolved: true } })

      const [m1, m2] = await Promise.all([
        prisma.match.create({
          data: {
            userId: sm.player1Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p2.firstName, opponentLastName: p2.lastName,
            note: noteStr, published: false, specialMatchId: cid,
            sets: {
              create: sets.map(s => ({
                setNumber: s.setNumber,
                playerScore: scorerIsP1 ? s.playerScore : s.opponentScore,
                opponentScore: scorerIsP1 ? s.opponentScore : s.playerScore,
              })),
            },
          },
        }),
        prisma.match.create({
          data: {
            userId: sm.player2Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p1.firstName, opponentLastName: p1.lastName,
            note: noteStr, published: false, specialMatchId: cid,
            sets: {
              create: sets.map(s => ({
                setNumber: s.setNumber,
                playerScore: scorerIsP1 ? s.opponentScore : s.playerScore,
                opponentScore: scorerIsP1 ? s.playerScore : s.opponentScore,
              })),
            },
          },
        }),
      ])

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    }

    // convType === 'planned'
    const pm = await prisma.plannedMatch.findUnique({
      where: { id: cid },
      include: { player1: true, player2: true },
    })
    if (!pm) return res.status(404).json({ error: 'Ce match a déjà été renseigné ou n\'existe plus.' })
    if (pm.player1Id !== uid && pm.player2Id !== uid)
      return res.status(403).json({ error: 'Ce match ne vous concerne pas.' })

    const matchDateObj = matchDate ? new Date(matchDate) : (pm.scheduledDate || new Date())
    const roundInt = pm.phase === 'PHASE2' ? pm.roundNumber : null
    const noteStr = note ? note.trim() : (pm.note || null)
    const scorerIsP1 = pm.player1Id === uid

    const [m1, m2] = await Promise.all([
      prisma.match.create({
        data: {
          userId: pm.player1Id, phase: pm.phase, roundNumber: roundInt,
          matchDate: matchDateObj,
          opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName,
          note: noteStr, published: false,
          sets: {
            create: sets.map(s => ({
              setNumber: s.setNumber,
              playerScore: scorerIsP1 ? s.playerScore : s.opponentScore,
              opponentScore: scorerIsP1 ? s.opponentScore : s.playerScore,
            })),
          },
        },
      }),
      prisma.match.create({
        data: {
          userId: pm.player2Id, phase: pm.phase, roundNumber: roundInt,
          matchDate: matchDateObj,
          opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName,
          note: noteStr, published: false,
          sets: {
            create: sets.map(s => ({
              setNumber: s.setNumber,
              playerScore: scorerIsP1 ? s.opponentScore : s.playerScore,
              opponentScore: scorerIsP1 ? s.playerScore : s.opponentScore,
            })),
          },
        },
      }),
    ])

    await prisma.plannedMatch.delete({ where: { id: cid } })

    return res.status(201).json({ ok: true, match1: m1, match2: m2 })
  } catch (err) {
    console.error('[convocations submit]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
