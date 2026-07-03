// api/login.js
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)
if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

// Comptes "communicants" : permet à un admin de basculer vers son compte joueur
// (et inversement) sans ressaisir ses identifiants.
const LINKED_ACCOUNTS = {
  admin: 'yanis',
  yanis: 'admin',
  root: 'alexandre',
  alexandre: 'root',
}

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

  // ── POST /api/login?action=resume — annuler un faux logout "page_closed" ────
  // (déclenché par un rafraîchissement de page : la session est en fait restée active)
  if (req.method === 'POST' && req.query?.action === 'resume') {
    const { loginEventId } = req.body || {}
    if (loginEventId) {
      try {
        const eid = parseInt(loginEventId, 10)
        if (!isNaN(eid)) {
          await prisma.loginEvent.updateMany({
            where: { id: eid, logoutReason: 'page_closed' },
            data: { logoutAt: null, logoutReason: null },
          })
        }
      } catch(e) { console.error('[resume log]', e) }
    }
    return res.status(200).json({ ok: true })
  }

  // ── POST /api/login?action=logout — enregistrer la déconnexion ──────────────
  if (req.method === 'POST' && req.query?.action === 'logout') {
    const { loginEventId, reason } = req.body || {}
    if (loginEventId) {
      try {
        const eid = parseInt(loginEventId, 10)
        if (!isNaN(eid)) {
          const validReasons = ['manual', 'inactivity', 'page_closed']
          await prisma.loginEvent.update({
            where: { id: eid },
            data: {
              logoutAt: new Date(),
              logoutReason: validReasons.includes(reason) ? reason : 'manual',
            },
          })
        }
      } catch(e) { console.error('[logout log]', e) }
    }
    return res.status(200).json({ ok: true })
  }

  // ── POST /api/login?action=switch_account — basculer vers le compte lié ─────
  if (req.method === 'POST' && req.query?.action === 'switch_account') {
    const authHeader = req.headers['authorization'] || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Non authentifié.' })

    let payload
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Session expirée ou invalide.' })
    }

    const currentUsername = (payload.username || '').toLowerCase()
    const targetUsername = LINKED_ACCOUNTS[currentUsername]
    if (!targetUsername) {
      return res.status(403).json({ error: 'Aucun compte lié à ce compte.' })
    }

    try {
      const targetUser = await prisma.user.findFirst({
        where: { username: { equals: targetUsername, mode: 'insensitive' } },
      })
      if (!targetUser) return res.status(404).json({ error: 'Compte lié introuvable.' })
      if (targetUser.banned) return res.status(403).json({ error: 'Le compte lié est banni.' })

      const isAdmin = ['admin', 'root'].includes(targetUser.username.toLowerCase()) || targetUser.role === 'ADMIN'

      if (!isAdmin && !targetUser.accepted) {
        return res.status(403).json({ error: 'Le compte lié n\'est pas encore validé.' })
      }

      // Clôturer l'événement de connexion précédent (changement de compte)
      const { loginEventId } = req.body || {}
      if (loginEventId) {
        const eid = parseInt(loginEventId, 10)
        if (!isNaN(eid)) {
          await prisma.loginEvent.updateMany({
            where: { id: eid, logoutAt: null },
            data: { logoutAt: new Date(), logoutReason: 'manual' },
          }).catch(() => {})
        }
      }

      const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
      const ip = rawIp ? rawIp.split(',')[0].trim() : null
      const loginEvent = await prisma.loginEvent.create({
        data: {
          userId: targetUser.id,
          ip,
          userAgent: req.headers['user-agent'] || null,
          success: true,
          message: `Changement de compte depuis @${payload.username}`,
        },
      })

      const newToken = jwt.sign(
        { userId: targetUser.id, username: targetUser.username, role: isAdmin ? 'ADMIN' : targetUser.role },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      )

      let pendingNotifications = []
      if (!isAdmin) {
        pendingNotifications = await prisma.notification.findMany({
          where: { userId: targetUser.id, read: false },
          orderBy: { createdAt: 'desc' },
        })
      }

      return res.status(200).json({
        token: newToken,
        loginEventId: loginEvent.id,
        user: {
          id: targetUser.id,
          username: targetUser.username,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          role: isAdmin ? 'ADMIN' : targetUser.role,
          category: targetUser.category,
          active: targetUser.active,
        },
        pendingNotifications,
      })
    } catch (err) {
      console.error('[switch_account]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { firstName, lastName, password } = req.body || {}

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ error: 'Prénom, nom et mot de passe requis.' })
  }

  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })

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
            html: `<h2>Tentative de connexion ADMIN</h2><p><strong>Résultat :</strong> mauvais mot de passe</p><p><strong>IP :</strong> ${(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()}</p>`,
          })
        } catch (mailErr) { console.error('[EMAIL ADMIN]', mailErr) }
      }
      await logLogin(user.id, req, false, 'Mot de passe incorrect')
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const isAdmin = ['admin', 'root'].includes(user.username.toLowerCase()) || user.role === 'ADMIN'

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

    // Créer l'événement de login et retourner son ID pour pouvoir logger le logout
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    const ip = rawIp ? rawIp.split(',')[0].trim() : null
    const loginEvent = await prisma.loginEvent.create({
      data: {
        userId: user.id,
        ip,
        userAgent: req.headers['user-agent'] || null,
        success: true,
        message: 'Connexion réussie',
      },
    })

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: isAdmin ? 'ADMIN' : user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
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
      loginEventId: loginEvent.id,
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
