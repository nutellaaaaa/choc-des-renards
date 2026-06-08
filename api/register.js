const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { Resend } = require('resend')

// Prisma singleton (important sur Vercel)
if (!global._prisma) {
  global._prisma = new PrismaClient()
}
const prisma = global._prisma

const resend = new Resend(process.env.RESEND_API_KEY)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Méthode non autorisée',
    })
  }

  const {
    username,
    password,
    confirmPassword,
    firstName,
    lastName,
    phone,
    category,
  } = req.body || {}

  if (
    !username ||
    !password ||
    !confirmPassword ||
    !firstName ||
    !lastName ||
    !phone ||
    !category
  ) {
    return res.status(400).json({
      error: 'Tous les champs sont requis.',
    })
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      error: 'Les mots de passe ne correspondent pas.',
    })
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: 'Le mot de passe doit contenir au moins 8 caractères.',
    })
  }

  const validCategories = ['N', 'R', 'D', 'P']

  if (!validCategories.includes(category)) {
    return res.status(400).json({
      error: 'Catégorie invalide.',
    })
  }

  try {
    const existing = await prisma.user.findUnique({
      where: {
        username,
      },
    })

    if (existing) {
      return res.status(409).json({
        error: 'Ce pseudo est déjà utilisé.',
      })
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    })

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        firstName,
        lastName,
        phone,
        category,
      },
    })

    // Notification email admin
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: process.env.ADMIN_EMAIL,
        subject: '🔔 Nouvelle inscription - Choc des Renards',
        html: `
          <h2>Nouvelle inscription</h2>

          <p><strong>Pseudo :</strong> ${username}</p>
          <p><strong>Nom :</strong> ${lastName}</p>
          <p><strong>Prénom :</strong> ${firstName}</p>
          <p><strong>Téléphone :</strong> ${phone}</p>
          <p><strong>Catégorie :</strong> ${category}</p>

          <br>

          <p>En attente de validation...</p>
        `,
      })
    } catch (mailError) {
      console.error('[EMAIL]', mailError)
      // On ne bloque pas l'inscription si l'email échoue
    }

    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '7d',
      }
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
    console.error('[REGISTER]', err)

    return res.status(500).json({
      error: 'Erreur serveur. Réessayez.',
    })
  }
}