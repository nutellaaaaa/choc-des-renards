const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')

const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

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
  const user = await prisma.user.findUnique({
    where: { username }
  })

  // Tentative sur admin inexistant
  if (!user) {
    if (username.toLowerCase() === 'admin') {
      try {
        await resend.emails.send({
          from: 'onboarding@resend.dev',
          to: process.env.ADMIN_EMAIL,
          subject: '⚠️ Tentative de connexion ADMIN',
          html: `
            <h2>Tentative de connexion ADMIN</h2>

            <p><strong>Pseudo :</strong> admin</p>
            <p><strong>Résultat :</strong> utilisateur introuvable</p>

            <p><strong>IP :</strong>
              ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}
            </p>

            <p><strong>User-Agent :</strong>
              ${req.headers['user-agent'] || 'inconnu'}
            </p>
          `
        })
      } catch (mailErr) {
        console.error('[EMAIL ADMIN]', mailErr)
      }
    }

    return res.status(401).json({
      error: 'Identifiants incorrects.'
    })
  }

  const valid = await argon2.verify(
    user.passwordHash,
    password
  )

  // Mauvais mot de passe admin
  if (!valid) {
    if (user.username.toLowerCase() === 'admin') {
      try {
        await resend.emails.send({
          from: 'onboarding@resend.dev',
          to: process.env.ADMIN_EMAIL,
          subject: '⚠️ Tentative de connexion ADMIN',
          html: `
            <h2>Tentative de connexion ADMIN</h2>

            <p><strong>Résultat :</strong> mauvais mot de passe</p>

            <p><strong>IP :</strong>
              ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}
            </p>

            <p><strong>User-Agent :</strong>
              ${req.headers['user-agent'] || 'inconnu'}
            </p>
          `
        })
      } catch (mailErr) {
        console.error('[EMAIL ADMIN]', mailErr)
      }
    }

    return res.status(401).json({
      error: 'Identifiants incorrects.'
    })
  }

  // Connexion réussie ADMIN
  if (user.username.toLowerCase() === 'admin') {
    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: process.env.ADMIN_EMAIL,
        subject: '✅ Connexion ADMIN réussie',
        html: `
          <h2>Connexion ADMIN réussie</h2>

          <p><strong>Date :</strong>
            ${new Date().toLocaleString('fr-FR')}
          </p>

          <p><strong>IP :</strong>
            ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}
          </p>

          <p><strong>User-Agent :</strong>
            ${req.headers['user-agent'] || 'inconnu'}
          </p>
        `
      })
    } catch (mailErr) {
      console.error('[EMAIL ADMIN]', mailErr)
    }
  }

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '24h',
    }
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

  return res.status(500).json({
    error: 'Erreur serveur. Réessayez.'
  })
}
}