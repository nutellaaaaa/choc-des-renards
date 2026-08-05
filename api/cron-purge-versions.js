// api/cron-purge-versions.js
//
// Déclenché quotidiennement par Vercel Cron (voir vercel.json → "crons").
// Purge définitivement les DataVersion dont expiresAt est dépassé (30 jours
// après création, voir lib/dataVersion.js → RETENTION_DAYS). Les entrées
// déjà restaurées sont purgées de la même façon : une fois restaurée, la
// version n'a plus d'utilité, ses données vivent désormais comme lignes
// normales dans la base.
const { PrismaClient } = require('@prisma/client')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

module.exports = async function handler(req, res) {
  // Vercel Cron envoie automatiquement `Authorization: Bearer $CRON_SECRET`
  // si la variable d'environnement CRON_SECRET est configurée sur le projet
  // (même garde que cron-deadline-reminders.js).
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || ''
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Non autorisé.' })
    }
  }

  try {
    const result = await prisma.dataVersion.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return res.status(200).json({ ok: true, purged: result.count })
  } catch (err) {
    console.error('[cron-purge-versions]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
