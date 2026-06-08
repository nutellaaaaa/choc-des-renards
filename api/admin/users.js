/**
 * api/admin/users.js
 * GET  /api/admin/users  — liste tous les utilisateurs acceptés (non en attente, non bannis)
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        phone: true, category: true, role: true,
        accepted: true, banned: true, createdAt: true,
      },
    })
    return res.status(200).json({ users })
  } catch (err) {
    console.error('[admin/users]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
