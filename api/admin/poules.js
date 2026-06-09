/**
 * api/admin/poules.js
 *
 * Gestion des poules (Phase 1) et des groupes Phase 2.
 *
 * GET  /api/admin/poules            → liste poules + groupes Phase 2
 *
 * POST /api/admin/poules
 *   action: 'create_poule'          → { name } → crée une poule
 *   action: 'rename_poule'          → { pouleId, name }
 *   action: 'delete_poule'          → { pouleId }
 *   action: 'add_member'            → { pouleId, userId }
 *   action: 'remove_member'         → { pouleId, userId }
 *   action: 'fill_random'           → { pouleId, count } → ajoute `count` joueurs aléatoires sans poule
 *
 *   action: 'create_group'          → { name } → crée un groupe Phase 2
 *   action: 'rename_group'          → { groupId, name }
 *   action: 'delete_group'          → { groupId }
 *   action: 'add_group_member'      → { groupId, userId }
 *   action: 'remove_group_member'   → { groupId, userId }
 */
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

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [poules, groups, allUsers] = await Promise.all([
        prisma.poule.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.phase2Group.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true },
          orderBy: { lastName: 'asc' },
        }),
      ])

      // Joueurs sans poule
      const inPoule = new Set(poules.flatMap(p => p.members.map(m => m.userId)))
      const unassigned = allUsers.filter(u => !inPoule.has(u.id))

      // Joueurs sans groupe Phase 2
      const inGroup = new Set(groups.flatMap(g => g.members.map(m => m.userId)))
      const unassignedGroups = allUsers.filter(u => !inGroup.has(u.id))

      return res.status(200).json({ poules, groups, unassigned, unassignedGroups, allUsers })
    } catch (err) {
      console.error('[admin/poules GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  // ── POULES ───────────────────────────────────────────────────────────────────

  if (action === 'create_poule') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const poule = await prisma.poule.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, poule })
    } catch (err) {
      console.error('[create_poule]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_poule') {
    const { pouleId, name } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid) || !name?.trim()) return res.status(400).json({ error: 'pouleId et name requis.' })
    try {
      const poule = await prisma.poule.update({ where: { id: pid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, poule })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_poule') {
    const { pouleId } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid)) return res.status(400).json({ error: 'pouleId invalide.' })
    try {
      await prisma.poule.delete({ where: { id: pid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'pouleId et userId invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })

    try {
      // Retirer d'une autre poule si existant
      await prisma.pouleMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.pouleMember.create({ data: { pouleId: pid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      console.error('[add_member]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.pouleMember.deleteMany({ where: { pouleId: pid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'fill_random') {
    const { pouleId, count } = req.body
    const pid = parseInt(pouleId, 10), cnt = parseInt(count, 10)
    if (isNaN(pid) || isNaN(cnt) || cnt < 1) return res.status(400).json({ error: 'Paramètres invalides.' })

    try {
      // Joueurs sans poule
      const allAssigned = await prisma.pouleMember.findMany({ select: { userId: true } })
      const assignedIds = new Set(allAssigned.map(m => m.userId))
      const eligible = await prisma.user.findMany({
        where: { accepted: true, banned: false, username: { notIn: ADMIN_USERNAMES } },
        select: { id: true },
      })
      const pool = eligible.filter(u => !assignedIds.has(u.id))

      if (pool.length === 0) return res.status(400).json({ error: 'Aucun joueur disponible.' })

      // Mélanger et prendre cnt joueurs
      const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, cnt)
      await prisma.pouleMember.createMany({
        data: shuffled.map(u => ({ pouleId: pid, userId: u.id })),
        skipDuplicates: true,
      })
      return res.status(200).json({ ok: true, added: shuffled.length })
    } catch (err) {
      console.error('[fill_random]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── GROUPES PHASE 2 ──────────────────────────────────────────────────────────

  if (action === 'create_group') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const group = await prisma.phase2Group.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_group') {
    const { groupId, name } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid) || !name?.trim()) return res.status(400).json({ error: 'groupId et name requis.' })
    try {
      const group = await prisma.phase2Group.update({ where: { id: gid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_group') {
    const { groupId } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid)) return res.status(400).json({ error: 'groupId invalide.' })
    try {
      await prisma.phase2Group.delete({ where: { id: gid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })

    try {
      await prisma.phase2GroupMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.phase2GroupMember.create({ data: { groupId: gid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.phase2GroupMember.deleteMany({ where: { groupId: gid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
