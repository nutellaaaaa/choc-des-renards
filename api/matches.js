// api/matches.js
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

// Ordre : victoires DESC, matchs joués ASC, points DESC, createdAt ASC (ancienneté)
function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.played !== b.played) return a.played - b.played
    if (b.points !== a.points) return b.points - a.points
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  // Rencontres en cours (public)
  if (req.query.public === '1') {
    try {
      const specials = await prisma.specialMatch.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
      })
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

  const isAdmin = auth.role === 'ADMIN' || ADMIN_USERNAMES.includes((auth.username || '').toLowerCase())

  try {
    const { userId } = req.query || {}

    // Requête joueur spécifique
    if (userId) {
      const uid = parseInt(userId, 10)
      if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })
      const user = await prisma.user.findUnique({
        where: { id: uid },
        select: {
          id: true, username: true, firstName: true, lastName: true,
          category: true, accepted: true, banned: true, active: true, createdAt: true,
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
          category: user.category, active: user.active,
          ...computeStats(user.matches),
          matches: user.matches,
        },
      })
    }

    // Liste complète
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, currentPhase: 'PHASE0', currentRound: null },
    })

    // Snapshot figé
    if (state.rankingSnapshot) {
      try {
        const snapshot = JSON.parse(state.rankingSnapshot)
        const response = {
          phase: state.currentPhase,
          round: state.currentRound,
          players: snapshot.players || snapshot,
          poules: snapshot.poules || [],
          phase2Groups: snapshot.phase2Groups || [],
        }
        // fromSnapshot visible uniquement par l'admin
        if (isAdmin) response.fromSnapshot = true
        return res.status(200).json(response)
      } catch { /* snapshot corrompu, recalcul */ }
    }

    // Seuls les joueurs actifs=true sont classés
    const users = await prisma.user.findMany({
      where: {
        accepted: true,
        banned: false,
        active: true,
        username: { notIn: ADMIN_USERNAMES },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        category: true, createdAt: true,
        matches: {
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
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
      createdAt: u.createdAt,
      pouleId: userPouleMap[u.id] || null,
      ...computeStats(u.matches),
      matches: u.matches,
    }))

    const poulesWithStats = poules.map(p => {
      const memberIds = new Set(p.members.map(m => m.userId))
      const poulePlayers = players.filter(pl => memberIds.has(pl.id))
      return {
        id: p.id, name: p.name, phase: p.phase,
        totalPoints: poulePlayers.reduce((a, pl) => a + pl.points, 0),
        totalWins:   poulePlayers.reduce((a, pl) => a + pl.wins, 0),
        members: sortPlayers(poulePlayers).map(pl => ({
          id: pl.id, firstName: pl.firstName, lastName: pl.lastName,
          username: pl.username, category: pl.category,
          points: pl.points, wins: pl.wins, losses: pl.losses,
          played: pl.played, setDiff: pl.setDiff,
        })),
      }
    })

    const response = {
      phase: state.currentPhase,
      round: state.currentRound,
      players: sortPlayers(players),
      poules: poulesWithStats,
      phase2Groups,
    }
    if (isAdmin) response.fromSnapshot = false

    return res.status(200).json(response)
  } catch (err) {
    console.error('[matches]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
