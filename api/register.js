const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
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
    return res.status(405).json({ error: 'Méthode non autorisée' })
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

  // Bloquer l'inscription avec les pseudos réservés aux admins
  if (['admin', 'root'].includes(username.toLowerCase())) {
    return res.status(400).json({ error: 'Ce pseudo est réservé.' })
  }

  try {
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' })
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    })

    // accepted=false par défaut (défini dans le schema Prisma)
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        firstName,
        lastName,
        phone,
        category,
        // accepted reste false (default), banned reste false (default)
      },
    })

    // Notification email admin
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: process.env.ADMIN_EMAIL,
        subject: '🔔 Nouvelle demande d\'inscription - Choc des Renards',
        html: `
          <h2>Nouvelle demande d'inscription</h2>
          <p><strong>Pseudo :</strong> ${username}</p>
          <p><strong>Nom :</strong> ${lastName}</p>
          <p><strong>Prénom :</strong> ${firstName}</p>
          <p><strong>Téléphone :</strong> ${phone}</p>
          <p><strong>Catégorie :</strong> ${category}</p>
          <br>
          <p>⏳ En attente de validation dans le panneau d'administration.</p>
        `,
      })
    } catch (mailError) {
      console.error('[EMAIL]', mailError)
    }

    // On ne renvoie PAS de token : l'utilisateur doit attendre la validation
    return res.status(201).json({
      pending: true,
      message: 'Votre demande d\'inscription a été envoyée. Elle sera validée par l\'administrateur avant de pouvoir vous connecter.',
    })

  } catch (err) {
    console.error('[REGISTER]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
