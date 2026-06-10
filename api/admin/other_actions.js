// api/admin/other_actions.js
// POST /api/admin/other_actions
// action: 'suspend_site' | 'unsuspend_site' | 'force_logout_all' | 'reset_all_matches' | 'reset_all_notifications' | 'deactivate_all_players'
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action requis.' })

  try {
    switch (action) {

      case 'suspend_site': {
        await prisma.tournamentState.upsert({
          where: { id: 1 },
          update: { siteSuspended: true },
          create: { id: 1, currentPhase: 'PHASE0', siteSuspended: true },
        })
        // Forcer déconnexion de tous les non-admins
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
        // Supprime tous les matchs, sets, poules, groupes, rencontres spéciales
        await prisma.matchSet.deleteMany({})
        await prisma.match.deleteMany({})
        await prisma.pouleMember.deleteMany({})
        await prisma.poule.deleteMany({})
        await prisma.phase2GroupMember.deleteMany({})
        await prisma.phase2Group.deleteMany({})
        await prisma.specialMatch.deleteMany({})
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
          where: {
            role: 'USER',
            username: { notIn: ADMIN_USERNAMES },
          },
          data: { active: false },
        })
        return res.status(200).json({ ok: true, message: 'Tous les joueurs ont été mis en inactif.' })
      }

      default:
        return res.status(400).json({ error: `Action inconnue : ${action}` })
    }
  } catch (err) {
    console.error('[admin/other_actions]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
