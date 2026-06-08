const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')

// Singleton Prisma pour éviter trop de connexions en serverless
if (!global._prisma) {
  global._prisma = new PrismaClient()
}
const prisma = global._prisma

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const { username, password } = req.body || {}

  if (!username || !password) {
    return res.status(400).json({ error: 'Pseudo et mot de passe requis.' })
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } })

    // Message volontairement générique pour ne pas révéler si le pseudo existe
    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        category: user.category,
      },
    })
  } catch (err) {
    console.error('[login]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
