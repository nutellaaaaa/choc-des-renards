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

  const { username, password, confirmPassword, firstName, lastName, phone, category } = req.body || {}

  // Validation des champs
  if (!username || !password || !confirmPassword || !firstName || !lastName || !phone || !category) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' })
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' })
  }

  const validCategories = ['N', 'R', 'D', 'P']
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Catégorie invalide.' })
  }

  try {
    // Vérification unicité du pseudo
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' })
    }

    // Hachage du mot de passe avec Argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    })

    // Création de l'utilisateur
    const user = await prisma.user.create({
      data: { username, passwordHash, firstName, lastName, phone, category },
    })

    // Génération du JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    return res.status(201).json({
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
    console.error('[register]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
