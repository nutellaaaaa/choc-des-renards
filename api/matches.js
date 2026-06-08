/**
 * api/matches.js
 *
 * GET /api/matches
 *   → Retourne tous les joueurs acceptés avec leurs matchs et statistiques calculées.
 *   Accessible à tout utilisateur authentifié (pas seulement admin).
 *
 * GET /api/matches?userId=X
 *   → Retourne uniquement les matchs d'un joueur spécifique.
 */
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

// Vérifie le JWT (utilisateur connecté, pas forcément admin)
function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    res.status(401).json({ error: 'Non authentifié.' })
    return null
  }
  try {
    return jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    res.status(401).json({ error: 'Session expirée ou invalide.' })
    return null
  }
}

/**
 * Calcule les stats d'un joueur à partir de ses matchs.
 * Victoire = joueur remporte plus de sets que l'adversaire.
 * Points : victoire = 3 pts, défaite = 1 pt
 */
function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0

  for (const m of matches) {
    const playerSetsWon   = m.sets.filter(s => s.playerScore   > s.opponentScore).length
    const opponentSetsWon = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++
    if (playerSetsWon > opponentSetsWon) wins++
    else losses++
    setDiff += playerSetsWon - opponentSetsWon
  }

  const points = wins * 3 + losses * 1

  return { played, wins, losses, setDiff, points }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = requireAuth(req, res)
  if (!auth) return

  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

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

    // ── Liste de tous les joueurs acceptés ──
    const users = await prisma.user.findMany({
      where: { accepted: true, banned: false },
      orderBy: { lastName: 'asc' },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        category: true,
        matches: {
          orderBy: { matchDate: 'desc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })

    // Phase courante
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, currentPhase: 'PHASE1', currentRound: null },
    })

    const players = users.map(u => ({
      id: u.id, username: u.username,
      firstName: u.firstName, lastName: u.lastName,
      category: u.category,
      ...computeStats(u.matches),
      matches: u.matches,
    }))

    return res.status(200).json({
      phase: state.currentPhase,
      round: state.currentRound,
      players,
    })

  } catch (err) {
    console.error('[matches]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
