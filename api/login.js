// api/login.js
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)
if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

async function logLogin(userId, req, success, message) {
  try {
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    const ip = rawIp ? rawIp.split(',')[0].trim() : null

    await prisma.loginEvent.create({
      data: {
        userId,
        ip,
        userAgent: req.headers['user-agent'] || null,
        success,
        message: message || null,
      },
    })
  } catch (e) { console.error('[LOGIN_LOG]', e) }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { firstName, lastName, password } = req.body || {}

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ error: 'Prénom, nom et mot de passe requis.' })
  }

  try {
    // Vérifier suspension du site
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    const isAdminLogin = false // on déterminera ça après

    // Rechercher par prénom + nom (insensible à la casse)
    const user = await prisma.user.findFirst({
      where: {
        firstName: { equals: firstName.trim(), mode: 'insensitive' },
        lastName:  { equals: lastName.trim(),  mode: 'insensitive' },
      },
    })

    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      if (['admin', 'root'].includes(user.username.toLowerCase())) {
        try {
          await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: process.env.ADMIN_EMAIL,
            subject: '⚠️ Tentative de connexion ADMIN',
			html: `<h2>Tentative de connexion ADMIN</h2><p><strong>Résultat :</strong> mauvais mot de passe</p><p><strong>IP :</strong> ${(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()}</p>`,          })
        } catch (mailErr) { console.error('[EMAIL ADMIN]', mailErr) }
      }
      await logLogin(user.id, req, false, 'Mot de passe incorrect')
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const isAdmin = ['admin', 'root'].includes(user.username.toLowerCase()) || user.role === 'ADMIN'

    // Vérif suspension site (les admins passent toujours)
    if (!isAdmin && state?.siteSuspended) {
      await logLogin(user.id, req, false, 'Site suspendu')
      return res.status(403).json({ error: 'Le site est temporairement suspendu. Revenez plus tard.' })
    }

    if (user.banned) {
      await logLogin(user.id, req, false, 'Compte banni')
      return res.status(403).json({ error: 'Votre compte a été banni. Contactez l\'administrateur.' })
    }

    if (!user.accepted) {
      await logLogin(user.id, req, false, 'Compte en attente de validation')
      return res.status(403).json({ error: 'Votre demande d\'inscription est en attente de validation par l\'administrateur.' })
    }

    // Réinitialiser forceLogout si actif
    if (user.forceLogout) {
      await prisma.user.update({ where: { id: user.id }, data: { forceLogout: false } })
    }

    if (isAdmin) {
		try {
			await resend.emails.send({
			from: 'onboarding@resend.dev',
			to: process.env.ADMIN_EMAIL,
			subject: '✅ Connexion ADMIN réussie',
			html: `<h2>Connexion ADMIN réussie</h2><p><strong>Pseudo :</strong> ${user.username}</p><p><strong>IP :</strong> ${(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()}</p>`,
			})
		} catch (mailErr) { console.error('[EMAIL ADMIN]', mailErr) }
	}

    await logLogin(user.id, req, true, 'Connexion réussie')

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: isAdmin ? 'ADMIN' : user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    )

    let pendingNotifications = []
    if (!isAdmin) {
      pendingNotifications = await prisma.notification.findMany({
        where: { userId: user.id, read: false },
        orderBy: { createdAt: 'desc' },
      })
    }

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: isAdmin ? 'ADMIN' : user.role,
        category: user.category,
        active: user.active,
      },
      pendingNotifications,
    })
  } catch (err) {
    console.error('[login]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
