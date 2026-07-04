// api/contact.js  (utilisateur connecté)
//
// POST /api/contact  { nature, subject, message } → enregistre une prise de contact
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const VALID_NATURES = [
  "Informer d'un score",
  'Signaler un comportement inapproprié',
  'Poser une question',
  'Proposer une fonctionnalité sur le site',
  "Proposer une idée sur l'organisation du tournoi",
  'Signaler un bug sur le site',
  'Autre',
]

function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Non authentifié.' }); return null }
  try { return jwt.verify(token, process.env.JWT_SECRET) }
  catch { res.status(401).json({ error: 'Session expirée ou invalide.' }); return null }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = requireAuth(req, res)
  if (!auth) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { nature, subject, message } = req.body || {}

  if (!nature || !VALID_NATURES.includes(nature)) {
    return res.status(400).json({ error: 'Nature de la demande invalide.' })
  }
  if (!subject?.trim()) return res.status(400).json({ error: 'L\'objet est requis.' })
  if (!message?.trim()) return res.status(400).json({ error: 'Le message est requis.' })

  try {
    const contact = await prisma.contactMessage.create({
      data: {
        userId: auth.userId,
        nature,
        subject: subject.trim(),
        message: message.trim(),
      },
    })
    return res.status(201).json({ ok: true, contact })
  } catch (err) {
    console.error('[contact]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
