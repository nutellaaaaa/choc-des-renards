// api/register.js
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const { Resend } = require('resend')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma
const resend = new Resend(process.env.RESEND_API_KEY)

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// Met en forme "jean-pierre" / "JEAN" / "jEan" → "Jean-Pierre" (gère espaces et tirets)
function capName(str) {
  if (!str) return str
  return str.toString().trim().split(/(\s|-)/).map(part =>
    /^[\s-]$/.test(part) ? part : (part.charAt(0).toLocaleUpperCase('fr-FR') + part.slice(1).toLocaleLowerCase('fr-FR'))
  ).join('')
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { password, confirmPassword, firstName, lastName, phone, acknowledged } = req.body || {}

  if (!password || !confirmPassword || !firstName || !lastName || !phone) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' })
  }
  if (!acknowledged) {
    return res.status(400).json({ error: 'Vous devez cocher la case de prise de connaissance des informations.' })
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' })
  }

  // Pseudo auto = prénom en minuscule sans accents ni espaces
  let username = slugify(firstName)
  if (!username) username = 'joueur'

  // Vérifier unicité du pseudo, ajouter suffix si besoin
  try {
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      // Essayer avec le nom aussi
      const alt = slugify(firstName + lastName)
      const existing2 = await prisma.user.findUnique({ where: { username: alt } })
      if (!existing2) {
        username = alt
      } else {
        // Suffixer avec un nombre aléatoire
        username = alt + Math.floor(Math.random() * 900 + 100)
      }
    }

    if (['admin', 'root'].includes(username.toLowerCase())) username = username + '_user'

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    })

    await prisma.user.create({
      data: {
        username,
        passwordHash,
        firstName: capName(firstName.trim()),
        lastName: capName(lastName.trim()),
        phone: phone.trim(),
        category: 'NC',
      },
    })

    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: process.env.ADMIN_EMAIL,
        subject: '🔔 Nouvelle demande d\'inscription - Choc des Renards',
        html: `<h2>Nouvelle demande d'inscription</h2>
          <p><strong>Pseudo attribué :</strong> ${username}</p>
          <p><strong>Nom :</strong> ${lastName}</p>
          <p><strong>Prénom :</strong> ${firstName}</p>
          <p><strong>Téléphone :</strong> ${phone}</p>
          <p><strong>Catégorie :</strong> NC (non-classé par défaut)</p>
          <br><p>⏳ En attente de validation dans le panneau d'administration.</p>`,
      })
    } catch (mailError) { console.error('[EMAIL]', mailError) }

    return res.status(201).json({
      pending: true,
      message: 'Votre demande d\'inscription a été envoyée. Elle sera validée par l\'administrateur avant de pouvoir vous connecter.',
    })
  } catch (err) {
    console.error('[REGISTER]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
