/**
 * api/matches.js
 *
 * GET /api/matches
 *   → Retourne tous les joueurs acceptés (hors admin/root) avec leurs matchs publiés et stats.
 *   Accessible à tout utilisateur authentifié.
 *
 * GET /api/matches?userId=X
 *   → Retourne uniquement les matchs publiés d'un joueur spécifique.
 *
 * GET /api/matches?public=1
 *   → Section publique : rencontres spéciales en cours (non résolues).
 *      Pas d'auth requise pour cet endpoint.
 */
const { PrismaClient } = require('@prisma/client')
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

function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0
  for (const m of matches) {
    const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
    const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++
    if (pw > ow) wins++; else losses++
    setDiff += pw - ow
  }
  const points = wins * 3 + losses * 1
  return { played, wins, losses, setDiff, points }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  // ── Rencontres en cours (public, sans auth) ──
  if (req.query.public === '1') {
    try {
      const specials = await prisma.specialMatch.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
        include: {
          // inclure noms des joueurs
        },
      })
      // Enrichir avec les noms des joueurs
      const enriched = await Promise.all(specials.map(async sm => {
        const [p1, p2] = await Promise.all([
          prisma.user.findUnique({ where: { id: sm.player1Id }, select: { id: true, firstName: true, lastName: true, username: true } }),
          prisma.user.findUnique({ where: { id: sm.player2Id }, select: { id: true, firstName: true, lastName: true, username: true } }),
        ])
        return { ...sm, player1: p1, player2: p2 }
      }))
      return res.status(200).json({ specials: enriched })
    } catch (err) {
      console.error('[matches public]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  const auth = requireAuth(req, res)
  if (!auth) return

  try {
    const { userId } = req.query || {}

    // ── Requête pour un joueur spécifique ──
    if (userId) {
      const uid = parseInt(userId, 10)
      if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

      const user = await prisma.user.findUnique({
        where: { id: uid },
        select: {
          id: true, username: true, firstName: true, lastName: true,
          category: true, accepted: true, banned: true,
          matches: {
            where: { published: true },
            orderBy: { matchDate: 'desc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      })
      if (!user) return res.status(404).json({ error: 'Joueur introuvable.' })

      return res.status(200).json({
        user: {
          id: user.id, username: user.username,
          firstName: user.firstName, lastName: user.lastName,
          category: user.category,
          ...computeStats(user.matches),
          matches: user.matches,
        },
      })
    }

    // ── Liste de tous les joueurs (hors admin/root) ──
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, currentPhase: 'PHASE1', currentRound: null },
    })

    // Si un snapshot figé existe, le retourner directement
    if (state.rankingSnapshot) {
      try {
        const snapshot = JSON.parse(state.rankingSnapshot)
        return res.status(200).json({
          phase: state.currentPhase,
          round: state.currentRound,
          players: snapshot.players || snapshot,
          fromSnapshot: true,
          poules: snapshot.poules || [],
          phase2Groups: snapshot.phase2Groups || [],
        })
      } catch { /* snapshot corrompu, on recalcule */ }
    }

    const users = await prisma.user.findMany({
      where: {
        accepted: true,
        banned: false,
        username: { notIn: ADMIN_USERNAMES },
      },
      orderBy: { lastName: 'asc' },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        category: true,
        matches: {
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })

    // Poules (Phase 1)
    const poules = await prisma.poule.findMany({
      include: { members: { include: { user: { select: { id: true } } } } },
    })

    // Groupes Phase 2
    const phase2Groups = await prisma.phase2Group.findMany({
      include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } } } },
    })

    // Map userId → pouleId
    const userPouleMap = {}
    for (const p of poules) {
      for (const m of p.members) userPouleMap[m.userId] = p.id
    }

    const players = users.map(u => ({
      id: u.id, username: u.username,
      firstName: u.firstName, lastName: u.lastName,
      category: u.category,
      pouleId: userPouleMap[u.id] || null,
      ...computeStats(u.matches),
      matches: u.matches,
    }))

    // Calcul stats par poule
    const poulesWithStats = poules.map(p => {
      const memberIds = new Set(p.members.map(m => m.userId))
      const poulePlayers = players.filter(pl => memberIds.has(pl.id))
      const totalPoints = poulePlayers.reduce((acc, pl) => acc + pl.points, 0)
      const totalWins   = poulePlayers.reduce((acc, pl) => acc + pl.wins, 0)
      return {
        id: p.id, name: p.name, phase: p.phase,
        totalPoints, totalWins,
        members: poulePlayers.map(pl => ({ id: pl.id, firstName: pl.firstName, lastName: pl.lastName, username: pl.username, category: pl.category, points: pl.points, wins: pl.wins, losses: pl.losses, played: pl.played, setDiff: pl.setDiff })),
      }
    })

    return res.status(200).json({
      phase: state.currentPhase,
      round: state.currentRound,
      players,
      poules: poulesWithStats,
      phase2Groups,
      fromSnapshot: false,
    })

  } catch (err) {
    console.error('[matches]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
