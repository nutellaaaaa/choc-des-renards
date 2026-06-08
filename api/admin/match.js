/**
 * api/admin/match.js
 *
 * POST /api/admin/match
 * Body :
 *   action: 'add' | 'delete'
 *
 *   add :
 *     userId, phase, round (si PHASE2), matchDate (ISO string),
 *     opponentFirstName, opponentLastName, note?,
 *     sets: [{ setNumber, playerScore, opponentScore }, ...]  (1 à 5 sets)
 *
 *   delete :
 *     matchId
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'add') {
    const {
      userId,
      phase,
      round,
      matchDate,
      opponentFirstName,
      opponentLastName,
      note,
      sets,
    } = req.body

    if (!userId || !phase || !matchDate || !opponentFirstName || !opponentLastName) {
      return res.status(400).json({ error: 'Champs requis manquants.' })
    }

    const validPhases = ['PHASE1', 'PHASE2']
    if (!validPhases.includes(phase)) {
      return res.status(400).json({ error: 'Phase invalide.' })
    }

    if (phase === 'PHASE2') {
      const r = parseInt(round, 10)
      if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2.' })
    }

    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5) {
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    }

    for (const s of sets) {
      if (
        typeof s.setNumber !== 'number' ||
        typeof s.playerScore !== 'number' ||
        typeof s.opponentScore !== 'number' ||
        s.setNumber < 1 || s.setNumber > 5 ||
        s.playerScore < 0 || s.opponentScore < 0
      ) {
        return res.status(400).json({ error: 'Données de set invalides.' })
      }
    }

    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || !user.accepted || user.banned) {
      return res.status(404).json({ error: 'Joueur introuvable ou inactif.' })
    }

    try {
      const match = await prisma.match.create({
        data: {
          userId: uid,
          phase,
          roundNumber: phase === 'PHASE2' ? parseInt(round, 10) : null,
          matchDate: new Date(matchDate),
          opponentFirstName: opponentFirstName.trim(),
          opponentLastName: opponentLastName.trim(),
          note: note ? note.trim() : null,
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
      return res.status(201).json({ ok: true, match })
    } catch (err) {
      console.error('[admin/match add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

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

  return res.status(400).json({ error: 'Action invalide. Valeurs : add, delete.' })
}
