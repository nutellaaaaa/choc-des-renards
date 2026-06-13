// api/admin/action.js
// ─ Actions sur un utilisateur (accept, refuse, ban, unban, activate, deactivate, update, delete_banned)
// ─ Actions globales (suspend_site, unsuspend_site, force_logout_all, reset_all_matches,
//                     reset_all_notifications, deactivate_all_players)
// ─ GET → liste de tous les utilisateurs
// ─ GET ?refused=1 → historique des inscriptions refusées
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  // ── GET : liste de tous les utilisateurs OU historique refusés ────────────
  if (req.method === 'GET') {
    try {
      // Historique des inscriptions refusées
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Actions GLOBALES (pas de userId requis)
  // ══════════════════════════════════════════════════════════════════════════════
  const globalActions = [
    'suspend_site', 'unsuspend_site', 'force_logout_all',
    'reset_all_matches', 'reset_all_notifications', 'deactivate_all_players',
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
      }
    } catch (err) {
      console.error('[admin/action global]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Actions sur un utilisateur précis (userId requis)
  // ══════════════════════════════════════════════════════════════════════════════
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
        // Conserver une trace avant suppression
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

      case 'update': {
        if (!data) return res.status(400).json({ error: 'Données de mise à jour manquantes.' })
        const { firstName, lastName, username, phone, category } = data
        const validCategories = ['N', 'R', 'D', 'P', 'NC']
        if (category && !validCategories.includes(category))
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
