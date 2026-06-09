/**
 * api/admin/match.js
 *
 * POST /api/admin/match
 * Body :
 *   action: 'add' | 'delete' | 'publish' | 'publish_all' | 'refresh_ranking'
 *
 *   add :
 *     userId, phase, round (si PHASE2), matchDate (ISO string),
 *     opponentFirstName, opponentLastName, note?,
 *     sets: [{ setNumber, playerScore, opponentScore }, ...]  (1 à 5 sets)
 *     → crée aussi le match miroir sur l'adversaire si celui-ci est un joueur enregistré
 *     → vérifie si une rencontre spéciale correspond, alerte sinon
 *
 *   delete :
 *     matchId
 *
 *   publish :
 *     matchId  → rend le match visible
 *
 *   publish_all :
 *     (aucun param supplémentaire) → publie tous les matchs en attente
 *
 *   refresh_ranking :
 *     (aucun param) → recalcule et fige le classement (ou efface le snapshot pour recalcul live)
 *     freeze?: boolean  (true = figer, false = remettre en live)
 *
 * GET /api/admin/match
 *   → liste les matchs en attente de publication
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  // ── GET : matchs en attente ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const pending = await prisma.match.findMany({
        where: { published: false },
        orderBy: { createdAt: 'desc' },
        include: {
          sets: { orderBy: { setNumber: 'asc' } },
          user: { select: { id: true, firstName: true, lastName: true, username: true } },
        },
      })
      return res.status(200).json({ pending })
    } catch (err) {
      console.error('[admin/match GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  // ── PUBLISH ──────────────────────────────────────────────────────────────────
  if (action === 'publish') {
    const { matchId } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.update({ where: { id: mid }, data: { published: true } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/match publish]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── PUBLISH ALL ───────────────────────────────────────────────────────────────
  if (action === 'publish_all') {
    try {
      const { count } = await prisma.match.updateMany({ where: { published: false }, data: { published: true } })
      return res.status(200).json({ ok: true, count })
    } catch (err) {
      console.error('[admin/match publish_all]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── REFRESH RANKING ───────────────────────────────────────────────────────────
  if (action === 'refresh_ranking') {
    const freeze = req.body.freeze !== false // default true

    try {
      if (!freeze) {
        // Effacer le snapshot → classement live
        await prisma.tournamentState.update({ where: { id: 1 }, data: { rankingSnapshot: null } })
        return res.status(200).json({ ok: true, message: 'Classement remis en live.' })
      }

      // Recalculer et figer
      const ADMIN_USERNAMES_LC = ADMIN_USERNAMES.map(u => u.toLowerCase())
      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, username: { notIn: ADMIN_USERNAMES } },
        select: {
          id: true, username: true, firstName: true, lastName: true, category: true,
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
        category: u.category,
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
          members: poulePlayers,
        }
      })

      const snapshot = JSON.stringify({ players, poules: poulesWithStats, phase2Groups })
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

  // ── ADD ───────────────────────────────────────────────────────────────────────
  if (action === 'add') {
    const { userId, phase, round, matchDate, opponentFirstName, opponentLastName, note, sets } = req.body

    if (!userId || !phase || !matchDate || !opponentFirstName || !opponentLastName)
      return res.status(400).json({ error: 'Champs requis manquants.' })

    const validPhases = ['PHASE1', 'PHASE2']
    if (!validPhases.includes(phase))
      return res.status(400).json({ error: 'Phase invalide.' })

    if (phase === 'PHASE2') {
      const r = parseInt(round, 10)
      if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2.' })
    }

    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

    for (const s of sets) {
      if (typeof s.setNumber !== 'number' || typeof s.playerScore !== 'number' || typeof s.opponentScore !== 'number'
        || s.setNumber < 1 || s.setNumber > 5 || s.playerScore < 0 || s.opponentScore < 0)
        return res.status(400).json({ error: 'Données de set invalides.' })
    }

    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

    const player = await prisma.user.findUnique({ where: { id: uid } })
    if (!player || !player.accepted || player.banned)
      return res.status(404).json({ error: 'Joueur introuvable ou inactif.' })

    // Bloquer admin/root
    if (ADMIN_USERNAMES.includes(player.username.toLowerCase()))
      return res.status(403).json({ error: 'Impossible d\'ajouter un match à un compte admin.' })

    try {
      const matchDateObj = new Date(matchDate)
      const roundInt = phase === 'PHASE2' ? parseInt(round, 10) : null

      // ── Vérifier si une rencontre spéciale correspond ──
      let specialMatchId = null
      let notInSpecials = false

      const openSpecials = await prisma.specialMatch.findMany({
        where: { resolved: false },
      })

      // Chercher un adversaire enregistré
      const oppUser = await prisma.user.findFirst({
        where: {
          firstName: { equals: opponentFirstName.trim(), mode: 'insensitive' },
          lastName:  { equals: opponentLastName.trim(),  mode: 'insensitive' },
          accepted: true, banned: false,
          username: { notIn: ADMIN_USERNAMES },
        },
      })

      if (openSpecials.length > 0) {
        // Chercher une rencontre qui implique ce joueur et l'adversaire
        const match = openSpecials.find(sm => {
          const involves1 = sm.player1Id === uid || sm.player2Id === uid
          const oppId = oppUser?.id
          const involves2 = oppId && (sm.player1Id === oppId || sm.player2Id === oppId)
          return involves1 && involves2
        })
        if (match) {
          specialMatchId = match.id
          // Marquer la rencontre comme résolue
          await prisma.specialMatch.update({ where: { id: match.id }, data: { resolved: true } })
        } else {
          notInSpecials = true
        }
      } else if (openSpecials.length === 0) {
        notInSpecials = true
      }

      // ── Créer le match principal (joueur A) ──
      const mainMatch = await prisma.match.create({
        data: {
          userId: uid,
          phase,
          roundNumber: roundInt,
          matchDate: matchDateObj,
          opponentFirstName: opponentFirstName.trim(),
          opponentLastName:  opponentLastName.trim(),
          note: note ? note.trim() : null,
          published: false,
          specialMatchId,
          sets: {
            create: sets.map(s => ({
              setNumber: s.setNumber,
              playerScore: s.playerScore,
              opponentScore: s.opponentScore,
            })),
          },
        },
        include: { sets: true },
      })

      // ── Créer le match miroir sur l'adversaire (joueur B) si enregistré ──
      let mirrorMatch = null
      if (oppUser && !ADMIN_USERNAMES.includes(oppUser.username.toLowerCase())) {
        const mirrorSets = sets.map(s => ({
          setNumber: s.setNumber,
          playerScore: s.opponentScore,   // inversé
          opponentScore: s.playerScore,   // inversé
        }))
        mirrorMatch = await prisma.match.create({
          data: {
            userId: oppUser.id,
            phase,
            roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: player.firstName,
            opponentLastName:  player.lastName,
            note: note ? note.trim() : null,
            published: false,
            specialMatchId,
            sets: { create: mirrorSets },
          },
          include: { sets: true },
        })
      }

      return res.status(201).json({
        ok: true,
        match: mainMatch,
        mirrorMatch,
        mirrorCreated: !!mirrorMatch,
        notInSpecials,
        warning: notInSpecials ? 'Ce match n\'est pas répertorié dans les rencontres en cours.' : null,
      })
    } catch (err) {
      console.error('[admin/match add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { matchId } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.delete({ where: { id: mid } })
      return res.status(200).json({ ok: true, message: 'Match supprimé.' })
    } catch (err) {
      console.error('[admin/match delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
