/**
 * api/admin/phase.js
 *
 * GET  /api/admin/phase  — récupère la phase courante
 * POST /api/admin/phase  — met à jour la phase courante
 *
 * Body POST : { phase: 'PHASE1' | 'PHASE2', round?: number }
 * phase='PHASE1' → Phase 1 Poules
 * phase='PHASE2', round=1 → Phase 2 Ronde 1
 * phase='PHASE2', round=2 → Phase 2 Ronde 2  (etc.)
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

  // GET : lecture publique (pas besoin d'auth pour afficher la phase)
  if (req.method === 'GET') {
    try {
      const state = await prisma.tournamentState.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, currentPhase: 'PHASE1', currentRound: null },
      })
      return res.status(200).json({ phase: state.currentPhase, round: state.currentRound })
    } catch (err) {
      console.error('[admin/phase GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // POST : réservé admin
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { phase, round } = req.body || {}

  const validPhases = ['PHASE1', 'PHASE2']
  if (!phase || !validPhases.includes(phase)) {
    return res.status(400).json({ error: 'Phase invalide. Valeurs : PHASE1, PHASE2.' })
  }

  if (phase === 'PHASE2') {
    const r = parseInt(round, 10)
    if (!r || r < 1) {
      return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2 (entier ≥ 1).' })
    }
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
