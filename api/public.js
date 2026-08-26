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
const { sendPushToUser } = require('./lib/sendPush')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

/** Vérifie si un onglet est visible pour les utilisateurs. */
async function isTabVisible(tabKey) {
  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    const hiddenTabs = JSON.parse(state?.hiddenTabs || '[]')
    return !hiddenTabs.includes(tabKey)
  } catch { return true }
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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
    case 'chat':
      return handleChat(req, res)
    case 'push':
      return handlePush(req, res)
    case 'badge_push':
      return handleBadgePush(req, res)
    case 'site_update':
      return handleSiteUpdate(req, res)
    case 'charte':
      return handleCharteRead(req, res)
    default:
      return res.status(400).json({ error: 'resource invalide ou manquant.' })
  }
}

/* ============================================================
 * PUSH — gestion des abonnements push web
 *
 *   GET    → renvoie la VAPID public key (côté frontend pour subscribe)
 *   POST   → enregistre un PushSubscription en base (upsert par endpoint)
 *   DELETE → supprime le PushSubscription de la base + révoque le token
 *
 * L'envoi réel (webpush.sendNotification) se fait depuis lib/sendPush.js,
 * appelé par admin.js lors de la création d'une Notification in-app.
 * ============================================================ */
async function handlePush(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return

  // ── GET : renvoie la clé publique VAPID ──────────────────────────────────
  if (req.method === 'GET') {
    const publicKey = process.env.VAPID_PUBLIC_KEY
    if (!publicKey) return res.status(503).json({ error: 'Push non configuré côté serveur.' })
    return res.status(200).json({ publicKey })
  }

  // ── POST : abonnement (+ test réel via webpush si test:true) ────────────
  if (req.method === 'POST') {
    const { subscription, test } = req.body || {}
    if (!subscription?.endpoint)
      return res.status(400).json({ error: 'subscription invalide.' })

    try {
      await prisma.pushSubscription.upsert({
        where:  { endpoint: subscription.endpoint },
        update: {
          userId:       auth.userId,
          subscription: JSON.stringify(subscription),
          updatedAt:    new Date(),
        },
        create: {
          userId:       auth.userId,
          endpoint:     subscription.endpoint,
          subscription: JSON.stringify(subscription),
        },
      })

      // Quand test:true, on envoie un VRAI push via webpush (serveur push → SW → OS).
      // Contrairement à reg.showNotification() côté client, ceci teste l'intégralité
      // de la chaîne : VAPID, endpoint, service push du navigateur, SW push event.
      if (test) {
        await sendPushToUser(prisma, auth.userId, {
          title: '🔔 Test CDR',
          body:  'Les notifications push fonctionnent correctement !',
          tab:   'notifications',
        })
        return res.status(200).json({ ok: true, tested: true })
      }

      return res.status(201).json({ ok: true })
    } catch (err) {
      console.error('[push POST]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── DELETE : désabonnement ────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {}
    if (!endpoint) return res.status(400).json({ error: 'endpoint requis.' })

    try {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint, userId: auth.userId },
      })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[push DELETE]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(405).json({ error: 'Méthode non autorisée.' })
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
      const LINKED_USERNAMES = ['yanis', 'alexandre']
      const canSeeAll = LINKED_USERNAMES.includes((auth.username || '').toLowerCase())
      const topics = await prisma.faqTopic.findMany({
        where: canSeeAll ? {} : { published: true },
        orderBy: { order: 'asc' },
        include: {
          items: { orderBy: { order: 'asc' } },
          votes: { where: { userId: auth.userId }, select: { useful: true } },
        },
      })

      const result = topics.map(t => ({
        id: t.id,
        question: t.question,
        published: t.published,
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
      const [specials, plannedAll] = await Promise.all([
        prisma.specialMatch.findMany({
          where: { resolved: false, OR: [{ player1Id: uid }, { player2Id: uid }] },
          orderBy: { endDate: 'asc' },
        }),
        prisma.plannedMatch.findMany({
          where: { forfeited: false, OR: [{ player1Id: uid }, { player2Id: uid }] },
          orderBy: { scheduledDate: 'asc' },
        }),
      ])

      // Un joueur peut avoir plusieurs matchs planifiés à venir, mais seul le
      // plus proche dans le temps doit apparaître comme "à renseigner" — les
      // autres ne sont pas encore d'actualité. Les matchs sans date programmée
      // sont classés après ceux qui en ont une ; s'il n'y a que ceux-là, le
      // premier (le plus ancien créé) sert de "prochain match".
      const planned = plannedAll.length > 0 ? [
        [...plannedAll].sort((a, b) => {
          if (a.scheduledDate && b.scheduledDate) return new Date(a.scheduledDate) - new Date(b.scheduledDate)
          if (a.scheduledDate) return -1
          if (b.scheduledDate) return 1
          return new Date(a.createdAt) - new Date(b.createdAt)
        })[0],
      ] : []

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

  // ── Action: add_photos ──
  // Permet à un joueur d'ajouter des photos à un match qu'il a lui-même créé
  // (et au match miroir de l'adversaire). Sécurité : le joueur doit être le
  // propriétaire (userId) d'au moins un des deux matchs.
  if (action === 'add_photos') {
    const { matchId, mirrorMatchId, photos } = req.body || {}
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!Array.isArray(photos) || photos.length === 0)
      return res.status(400).json({ error: 'photos requis (array).' })
    try {
      // Vérifier que le joueur est propriétaire du match
      const match = await prisma.match.findUnique({ where: { id: mid } })
      if (!match) return res.status(404).json({ error: 'Match introuvable.' })
      if (match.userId !== uid)
        return res.status(403).json({ error: 'Vous ne pouvez ajouter des photos qu\'à vos propres matchs.' })

      const created = await prisma.matchPhoto.createMany({
        data: photos.map(p => ({
          matchId: mid,
          url: p.url,
          publicId: p.publicId || null,
          caption: p.caption || null,
        })),
      })

      // Ajouter aussi au match miroir (si fourni et valide)
      if (mirrorMatchId) {
        const mmid = parseInt(mirrorMatchId, 10)
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
      console.error('[convocations add_photos]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

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
    if (s.playerScore < 0 || s.opponentScore < 0 || s.playerScore > 11 || s.opponentScore > 11) {
      return res.status(400).json({ error: 'Chaque score de set doit être compris entre 0 et 11 points.' })
    }
  }

  // Vérification serveur : seul le gagnant peut soumettre.
  const submitterSetWins = sets.filter(s => s.playerScore > s.opponentScore).length
  const opponentSetWins  = sets.filter(s => s.opponentScore > s.playerScore).length
  if (submitterSetWins <= opponentSetWins) {
    return res.status(403).json({
      error: 'D\'après le score saisi, vous n\'avez pas gagné ce match. Seul le gagnant peut renseigner le score.',
    })
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
      const winner = scorerIsP1 ? p1 : p2
      const loser  = scorerIsP1 ? p2 : p1

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

      // Notification au perdant
      const loserScoreSummary = sets.map(s => `${s.opponentScore}–${s.playerScore}`).join(', ')
      await prisma.notification.create({
        data: {
          userId: loser.id,
          type: 'message',
          title: 'Score de votre match renseigné',
          message: `${winner.firstName} ${winner.lastName} a renseigné le score de votre rencontre spéciale. Résultat (votre score) : ${loserScoreSummary}. En attente de publication.`,
          opponentName: `${winner.firstName} ${winner.lastName}`,
        },
      })
      // Push téléphone au perdant
      ;(async () => {
        try {
          if (await isTabVisible('score')) {
            await sendPushToUser(prisma, loser.id, {
              title: '🏸 Score renseigné par votre adversaire',
              body: `${winner.firstName} ${winner.lastName} a saisi le score : ${loserScoreSummary} (votre côté). En attente de publication.`,
              tab: 'score',
            })
          }
        } catch {}
      })()
      // Push au gagnant également (confirmation)
      ;(async () => {
        try {
          if (await isTabVisible('score')) {
            await sendPushToUser(prisma, winner.id, {
              title: '✅ Score soumis avec succès',
              body: `Le score de votre rencontre spéciale contre ${loser.firstName} ${loser.lastName} a été soumis. En attente de publication par l'admin.`,
              tab: 'score',
            })
          }
        } catch {}
      })()

      // Message automatique dans la conversation du match (si elle existe)
      const winnerScoreSummary = sets.map(s => `${s.playerScore}–${s.opponentScore}`).join(', ')
      const specialChat = await prisma.matchChat.findUnique({ where: { specialMatchId: cid } })
      if (specialChat) {
        await prisma.matchChatMessage.create({
          data: {
            chatId: specialChat.id,
            senderId: null,
            isAuto: true,
            content: `🏸 Score renseigné par ${winner.firstName} ${winner.lastName} : ${winnerScoreSummary} (du point de vue de ${winner.firstName}). En attente de publication par l'administrateur.`,
          },
        })
        // Push fermeture du chat (rencontre spéciale) — await obligatoire (Vercel)
        await Promise.allSettled([
          sendPushToUser(prisma, specialChat.player1Id, {
            title: '💬 Conversation clôturée',
            body: `La conversation avec ${specialChat.player1Id === winner.id ? loser.firstName : winner.firstName} ${specialChat.player1Id === winner.id ? loser.lastName : winner.lastName} est terminée — le score a été soumis.`,
            tab: 'messages',
          }),
          sendPushToUser(prisma, specialChat.player2Id, {
            title: '💬 Conversation clôturée',
            body: `La conversation avec ${specialChat.player2Id === winner.id ? loser.firstName : winner.firstName} ${specialChat.player2Id === winner.id ? loser.lastName : winner.lastName} est terminée — le score a été soumis.`,
            tab: 'messages',
          }),
        ])
      }

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
    const winner = scorerIsP1 ? pm.player1 : pm.player2
    const loser  = scorerIsP1 ? pm.player2 : pm.player1

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

    // Notification au perdant
    const loserScoreSummary = sets.map(s => `${s.opponentScore}–${s.playerScore}`).join(', ')
    await prisma.notification.create({
      data: {
        userId: loser.id,
        type: 'message',
        title: 'Score de votre match renseigné',
        message: `${winner.firstName} ${winner.lastName} a renseigné le score de votre match. Résultat (votre score) : ${loserScoreSummary}. En attente de publication.`,
        opponentName: `${winner.firstName} ${winner.lastName}`,
      },
    })
    // Push téléphone — score renseigné (perdant + gagnant)
    ;(async () => {
      try {
        if (await isTabVisible('score')) {
          await sendPushToUser(prisma, loser.id, {
            title: '🏸 Score renseigné par votre adversaire',
            body: `${winner.firstName} ${winner.lastName} a saisi le score : ${loserScoreSummary} (votre côté). En attente de publication.`,
            tab: 'score',
          })
          await sendPushToUser(prisma, winner.id, {
            title: '✅ Score soumis avec succès',
            body: `Score contre ${loser.firstName} ${loser.lastName} soumis. En attente de publication par l'admin.`,
            tab: 'score',
          })
        }
      } catch {}
    })()

    // Message automatique dans la conversation du match.
    // Le plannedMatch vient d'être supprimé (delete ci-dessus) → on recherche
    // le chat par plannedMatchId qui peut être null (SetNull) ou par player1/2.
    const winnerScoreSummary = sets.map(s => `${s.playerScore}–${s.opponentScore}`).join(', ')
    const plannedChat = await prisma.matchChat.findFirst({
      where: {
        player1Id: pm.player1Id,
        player2Id: pm.player2Id,
        phase: pm.phase,
      },
    })
    if (plannedChat) {
      await prisma.matchChatMessage.create({
        data: {
          chatId: plannedChat.id,
          senderId: null,
          isAuto: true,
          content: `🏸 Score renseigné par ${winner.firstName} ${winner.lastName} : ${winnerScoreSummary} (du point de vue de ${winner.firstName}). En attente de publication par l'administrateur.`,
        },
      })
      // Push fermeture du chat — await obligatoire (Vercel)
      await Promise.allSettled([
        sendPushToUser(prisma, pm.player1Id, {
          title: '💬 Conversation clôturée',
          body: `La conversation avec ${pm.player2.firstName} ${pm.player2.lastName} est terminée — le score a été soumis.`,
          tab: 'messages',
        }),
        sendPushToUser(prisma, pm.player2Id, {
          title: '💬 Conversation clôturée',
          body: `La conversation avec ${pm.player1.firstName} ${pm.player1.lastName} est terminée — le score a été soumis.`,
          tab: 'messages',
        }),
      ])
    }

    return res.status(201).json({ ok: true, match1: m1, match2: m2 })
  } catch (err) {
    console.error('[convocations submit]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
/* ============================================================
 * CHAT — Communication joueur-joueur autour d'un match planifié
 * ou d'une rencontre spéciale.
 *
 * GET  ?resource=chat                → liste des conversations actives
 * GET  ?resource=chat&chatId=N       → messages d'une conversation
 * POST ?resource=chat { action: 'send', chatId, content } → envoyer un message
 * POST ?resource=chat { action: 'read', chatId }          → marquer comme lu
 * ============================================================ */
async function handleChat(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return
  const uid = auth.userId

  // ── GET : liste des chats ou messages d'un chat ──
  if (req.method === 'GET') {
    const chatId = req.query.chatId ? parseInt(req.query.chatId, 10) : null

    // Messages d'une conversation spécifique
    if (chatId) {
      try {
        const chat = await prisma.matchChat.findUnique({
          where: { id: chatId },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true } },
            messages: {
              orderBy: { createdAt: 'asc' },
              include: {
                sender: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        })
        if (!chat) return res.status(404).json({ error: 'Conversation introuvable.' })
        if (chat.player1Id !== uid && chat.player2Id !== uid)
          return res.status(403).json({ error: 'Cette conversation ne vous concerne pas.' })

        // Marquer tous les messages non lus par ce joueur comme lus
        const toMark = chat.messages.filter(m => {
          const readBy = JSON.parse(m.readBy || '[]')
          return !readBy.includes(uid)
        })
        if (toMark.length > 0) {
          await Promise.all(toMark.map(m => {
            const readBy = JSON.parse(m.readBy || '[]')
            readBy.push(uid)
            return prisma.matchChatMessage.update({
              where: { id: m.id },
              data: { readBy: JSON.stringify(readBy) },
            })
          }))
        }

        return res.status(200).json({ chat })
      } catch (err) {
        console.error('[chat GET messages]', err)
        return res.status(500).json({ error: 'Erreur serveur.' })
      }
    }

    // Liste des conversations actives pour ce joueur
    try {
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      const currentPhase = state?.currentPhase || 'PHASE0'

      // ── Auto-création des conversations manquantes ──
      // On récupère tous les matchs planifiés et rencontres spéciales actifs
      // du joueur, et on crée un MatchChat pour chaque paire qui n'en a pas encore.
      const [plannedMatches, specialMatches] = await Promise.all([
        prisma.plannedMatch.findMany({
          where: {
            forfeited: false,
            OR: [{ player1Id: uid }, { player2Id: uid }],
          },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true } },
            player2: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        prisma.specialMatch.findMany({
          where: {
            resolved: false,
            OR: [{ player1Id: uid }, { player2Id: uid }],
          },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true } },
            player2: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ])

      // Créer les chats manquants pour les PlannedMatches
      for (const pm of plannedMatches) {
        const existing = await prisma.matchChat.findUnique({
          where: { plannedMatchId: pm.id },
        })
        if (!existing) {
          const newChat = await prisma.matchChat.create({
            data: { player1Id: pm.player1Id, player2Id: pm.player2Id, phase: pm.phase, plannedMatchId: pm.id },
          })
          await prisma.matchChatMessage.create({
            data: {
              chatId: newChat.id, senderId: null, isAuto: true,
              content: `💬 Conversation ouverte entre ${pm.player1.firstName} ${pm.player1.lastName} et ${pm.player2.firstName} ${pm.player2.lastName}. Utilisez cet espace pour organiser votre match. Le score devra être renseigné dans l'onglet "Score du match" par le gagnant.`,
            },
          })
        }
      }

      // Créer les chats manquants pour les SpecialMatches
      for (const sm of specialMatches) {
        const existing = await prisma.matchChat.findUnique({ where: { specialMatchId: sm.id } })
        if (!existing) {
          const newChat = await prisma.matchChat.create({
            data: { player1Id: sm.player1Id, player2Id: sm.player2Id, phase: currentPhase, specialMatchId: sm.id },
          })
          await prisma.matchChatMessage.create({
            data: {
              chatId: newChat.id, senderId: null, isAuto: true,
              content: `💬 Conversation ouverte entre ${sm.player1.firstName} ${sm.player1.lastName} et ${sm.player2.firstName} ${sm.player2.lastName}. Utilisez cet espace pour organiser votre rencontre spéciale. Le score devra être renseigné dans l'onglet "Score du match" par le gagnant.`,
            },
          })
        }
      }

      // Charger tous les chats actifs du joueur (quelle que soit la phase)
      // On exclut les chats "orphelins" dont le match associé a été supprimé
      // (plannedMatchId = null ET specialMatchId = null après onDelete: SetNull).
      const chats = await prisma.matchChat.findMany({
        where: {
          AND: [
            { OR: [{ player1Id: uid }, { player2Id: uid }] },
            { OR: [
              { plannedMatchId: { not: null } },
              { specialMatchId: { not: null } },
            ]},
          ],
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      // Compter les messages non lus par conversation
      const enriched = await Promise.all(chats.map(async c => {
        const allMessages = await prisma.matchChatMessage.findMany({
          where: { chatId: c.id },
          select: { readBy: true },
        })
        const unread = allMessages.filter(m => {
          const readBy = JSON.parse(m.readBy || '[]')
          return !readBy.includes(uid)
        }).length
        const opponent = c.player1Id === uid ? c.player2 : c.player1
        const lastMsg = c.messages[0] || null
        return {
          id: c.id,
          phase: c.phase,
          opponent,
          lastMessage: lastMsg ? { content: lastMsg.content, createdAt: lastMsg.createdAt, isAuto: lastMsg.isAuto } : null,
          unreadCount: unread,
        }
      }))

      const totalUnread = enriched.reduce((a, c) => a + c.unreadCount, 0)
      return res.status(200).json({ chats: enriched, totalUnread })
    } catch (err) {
      console.error('[chat GET list]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' })

  const { action, chatId, content } = req.body || {}

  // ── POST action: create ──
  // Crée la conversation si elle n'existe pas encore. Pas de chatId ici (la conv
  // n'existe pas encore), donc on le traite en premier avant toute validation de chatId.
  if (action === 'create') {
    const { convType, convId } = req.body || {}
    const convIdInt = parseInt(convId, 10)
    if (!['special', 'planned'].includes(convType) || isNaN(convIdInt))
      return res.status(400).json({ error: 'convType/convId invalides.' })

    try {
      let player1Id, player2Id, phase, plannedMatchId = null, specialMatchId = null
      if (convType === 'planned') {
        const pm = await prisma.plannedMatch.findUnique({ where: { id: convIdInt } })
        if (!pm) return res.status(404).json({ error: 'Match planifié introuvable.' })
        if (pm.player1Id !== uid && pm.player2Id !== uid)
          return res.status(403).json({ error: 'Ce match ne vous concerne pas.' })
        player1Id = pm.player1Id; player2Id = pm.player2Id
        phase = pm.phase; plannedMatchId = pm.id
      } else {
        const sm = await prisma.specialMatch.findUnique({ where: { id: convIdInt } })
        if (!sm) return res.status(404).json({ error: 'Rencontre spéciale introuvable.' })
        if (sm.player1Id !== uid && sm.player2Id !== uid)
          return res.status(403).json({ error: 'Ce match ne vous concerne pas.' })
        player1Id = sm.player1Id; player2Id = sm.player2Id
        const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
        phase = state?.currentPhase || 'PHASE0'
        specialMatchId = sm.id
      }

      // Récupérer la conversation existante ou en créer une nouvelle
      const existing = plannedMatchId
        ? await prisma.matchChat.findFirst({ where: { player1Id, player2Id, phase } })
        : await prisma.matchChat.findUnique({ where: { specialMatchId } })

      if (existing) return res.status(200).json({ ok: true, chatId: existing.id, created: false })

      const newChat = await prisma.matchChat.create({
        data: { player1Id, player2Id, phase, plannedMatchId, specialMatchId },
      })

      // Message de bienvenue automatique
      const [p1, p2] = await Promise.all([
        prisma.user.findUnique({ where: { id: player1Id }, select: { firstName: true, lastName: true } }),
        prisma.user.findUnique({ where: { id: player2Id }, select: { firstName: true, lastName: true } }),
      ])
      await prisma.matchChatMessage.create({
        data: {
          chatId: newChat.id,
          senderId: null,
          isAuto: true,
          content: `💬 Conversation ouverte entre ${p1.firstName} ${p1.lastName} et ${p2.firstName} ${p2.lastName}. Utilisez cet espace pour organiser votre match (date, lieu, heure). Le score devra être renseigné dans l'onglet "Score du match" par le gagnant.`,
        },
      })

      // Push à l'adversaire pour l'informer de l'ouverture du chat
      const opponentId = player1Id === uid ? player2Id : player1Id
      const myData = await prisma.user.findUnique({ where: { id: uid }, select: { firstName: true, lastName: true } })
      const myName = myData ? `${myData.firstName} ${myData.lastName}` : 'Un joueur'
      await sendPushToUser(prisma, opponentId, {
        title: '💬 Conversation ouverte',
        body: `${myName} a ouvert la discussion pour organiser votre match.`,
        tab: 'messages',
      }).catch(() => {})
      return res.status(201).json({ ok: true, chatId: newChat.id, created: true })
    } catch (err) {
      console.error('[chat create]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Pour send et toute autre action, le chatId est obligatoire
  const cid = parseInt(chatId, 10)
  if (isNaN(cid)) return res.status(400).json({ error: 'chatId invalide.' })

  // Vérifier que le joueur est bien participant de cette conversation
  const chat = await prisma.matchChat.findUnique({ where: { id: cid } })
  if (!chat) return res.status(404).json({ error: 'Conversation introuvable.' })
  if (chat.player1Id !== uid && chat.player2Id !== uid)
    return res.status(403).json({ error: 'Cette conversation ne vous concerne pas.' })

  // ── POST action: send ──
  if (action === 'send') {
    const text = (content || '').trim()
    if (!text) return res.status(400).json({ error: 'Message vide.' })
    if (text.length > 500) return res.status(400).json({ error: 'Message trop long (500 caractères max).' })

    try {
      const readBy = JSON.stringify([uid])
      const msg = await prisma.matchChatMessage.create({
        data: {
          chatId: cid,
          senderId: uid,
          content: text,
          isAuto: false,
          readBy,
        },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      // Push téléphone à l'autre joueur — await obligatoire (Vercel)
      const recipientId = chat.player1Id === uid ? chat.player2Id : chat.player1Id
      const senderName = `${msg.sender.firstName} ${msg.sender.lastName}`
      await sendPushToUser(prisma, recipientId, {
        title: `💬 ${senderName}`,
        body: text.length > 80 ? text.slice(0, 77) + '…' : text,
        tab: 'messages',
      }).catch(() => {})
      return res.status(201).json({ ok: true, message: msg })
    } catch (err) {
      console.error('[chat send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * BADGE_PUSH — le client signale qu'un badge a été obtenu pour
 * la première fois (calculé côté JS) et demande l'envoi d'un
 * push téléphone. Anti-spam : un push par badge par joueur
 * par période de 24h (vérifié via Notification en base).
 *
 * POST ?resource=badge_push { badgeKey, badgeLabel, badgeEmoji }
 * ============================================================ */
async function handleBadgePush(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' })

  const { badgeKey, badgeLabel, badgeEmoji } = req.body || {}
  if (!badgeKey || typeof badgeKey !== 'string' || badgeKey.length > 50)
    return res.status(400).json({ error: 'badgeKey invalide.' })

  try {
    // Anti-spam : si un push de ce badge a déjà été envoyé dans les 24h, on ignore
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const alreadySent = await prisma.notification.findFirst({
      where: {
        userId: auth.userId,
        type: 'badge',
        title: { contains: badgeKey },
        createdAt: { gte: cutoff },
      },
    })
    if (alreadySent) return res.status(200).json({ ok: true, skipped: true })

    // Vérifier que l'onglet performances est visible avant de notifier
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    const hiddenTabs = JSON.parse(state?.hiddenTabs || '[]')
    if (hiddenTabs.includes('performances')) return res.status(200).json({ ok: true, skipped: true })

    const emoji = (badgeEmoji || '🏅').trim().slice(0, 10)
    const label = (badgeLabel || badgeKey).trim().slice(0, 60)

    // Créer une notification in-app légère (pour l'historique anti-spam)
    await prisma.notification.create({
      data: {
        userId: auth.userId,
        type: 'badge',
        title: `badge:${badgeKey}`,
        message: `Vous venez d'obtenir le badge "${label}" dans l'onglet Performances !`,
        read: true, // déjà visible dans l'appli, pas besoin de pop-up in-app
        readAt: new Date(),
      },
    })

    // Push téléphone
    await sendPushToUser(prisma, auth.userId, {
      title: `${emoji} Nouveau badge !`,
      body: `Vous venez de décrocher le badge "${label}". Consultez vos performances.`,
      tab: 'performances',
    })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[badge_push]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * SITE_UPDATE — annonce plein écran bloquante ("Mise à jour du
 * site") affichée aux joueurs (jamais aux admins) tant qu'ils
 * n'ont pas cliqué "Installer la mise à jour".
 *
 * GET  ?resource=site_update
 *   → calcule l'update "active" = la plus récente parmi celles
 *     dont le déploiement est atteint (instant=true, ou
 *     scheduledAt <= now()), et indique si CE user doit la voir
 *     (comparaison avec user.lastSeenSiteUpdateId). Les admins
 *     ne voient jamais rien ici (pending: false).
 *
 * POST ?resource=site_update  { action: 'acknowledge', updateId }
 *   → marque l'update comme installée pour ce user
 *     (User.lastSeenSiteUpdateId = updateId).
 * ============================================================ */
async function handleSiteUpdate(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { role: true, lastSeenSiteUpdateId: true },
      })
      if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' })

      // Les admins ne sont jamais bloqués par la page de mise à jour.
      if (user.role === 'ADMIN') {
        return res.status(200).json({ pending: false })
      }

      const now = new Date()
      const candidates = await prisma.siteUpdate.findMany({
        where: {
          OR: [
            { instant: true },
            { instant: false, scheduledAt: { lte: now } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { items: { orderBy: { order: 'asc' } } },
      })

      const active = candidates[0] || null
      const pending = !!active && active.id !== user.lastSeenSiteUpdateId

      if (!pending) return res.status(200).json({ pending: false })

      return res.status(200).json({
        pending: true,
        update: {
          id: active.id,
          title: active.title,
          items: active.items.map(i => ({ id: i.id, subtitle: i.subtitle, content: i.content })),
        },
      })
    } catch (err) {
      console.error('[site_update GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' })

  const { action, updateId } = req.body || {}
  if (action !== 'acknowledge') return res.status(400).json({ error: 'Action invalide.' })

  const uid = parseInt(updateId, 10)
  if (isNaN(uid)) return res.status(400).json({ error: 'updateId invalide.' })

  try {
    const update = await prisma.siteUpdate.findUnique({ where: { id: uid } })
    if (!update) return res.status(404).json({ error: 'Mise à jour introuvable.' })

    await prisma.user.update({
      where: { id: auth.userId },
      data: { lastSeenSiteUpdateId: uid },
    })
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[site_update acknowledge]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * CHARTE — lecture seule des articles de la Charte (édités côté
 * admin, voir admin.js resource=charte). Même contenu pour tous
 * les joueurs, pas de personnalisation par utilisateur.
 * ============================================================ */
async function handleCharteRead(req, res) {
  const auth = requireAuth(req, res)
  if (!auth) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' })

  try {
    const articles = await prisma.charteArticle.findMany({
      orderBy: { order: 'asc' },
      include: { items: { orderBy: { order: 'asc' } } },
    })
    const result = articles.map(a => ({
      id: a.id,
      title: a.title,
      items: a.items.map(i => ({ id: i.id, subtitle: i.subtitle, content: i.content })),
    }))
    return res.status(200).json({ articles: result })
  } catch (err) {
    console.error('[charte GET]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
