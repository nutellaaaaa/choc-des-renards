// api/cron-deadline-reminders.js
//
// Déclenché périodiquement par Vercel Cron (voir vercel.json → "crons").
// Envoie une notification "rappel de deadline" aux joueurs dont la deadline
// de saisie de score (PlannedMatch.deadlineAt) tombe dans les 48h à venir,
// une seule fois par match/joueur (dédoublonnage via l'existence d'une
// Notification type='deadline_reminder' pour ce plannedMatchId + userId).
//
// Toute notification envoyée est aussi journalisée dans la console de
// planification (SchedulingLog), au même titre que les autres notifications
// liées à la planification des matchs.
const { PrismaClient } = require('@prisma/client')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const REMINDER_WINDOW_HOURS = 48

function fmtDateTime(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

module.exports = async function handler(req, res) {
  // Vercel Cron envoie automatiquement `Authorization: Bearer $CRON_SECRET`
  // si la variable d'environnement CRON_SECRET est configurée sur le projet.
  // Sans cette variable, la vérification est ignorée (pratique en local/dev,
  // mais pensez à définir CRON_SECRET en production pour éviter qu'un tiers
  // ne déclenche cette route à volonté).
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || ''
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Non autorisé.' })
    }
  }

  try {
    const now = new Date()
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000)

    const matches = await prisma.plannedMatch.findMany({
      where: { forfeited: false, deadlineAt: { gte: now, lte: windowEnd } },
      include: {
        player1: { select: { id: true, firstName: true, lastName: true, username: true } },
        player2: { select: { id: true, firstName: true, lastName: true, username: true } },
      },
    })

    if (matches.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 })
    }

    const matchIds = matches.map(m => m.id)
    const alreadySent = await prisma.notification.findMany({
      where: { type: 'deadline_reminder', plannedMatchId: { in: matchIds } },
      select: { userId: true, plannedMatchId: true },
    })
    const sentKeys = new Set(alreadySent.map(n => `${n.plannedMatchId}-${n.userId}`))

    let sent = 0
    for (const pm of matches) {
      const pairs = [
        { user: pm.player1, opponent: pm.player2 },
        { user: pm.player2, opponent: pm.player1 },
      ]
      for (const { user, opponent } of pairs) {
        const key = `${pm.id}-${user.id}`
        if (sentKeys.has(key)) continue

        const deadlineStr = fmtDateTime(pm.deadlineAt)
        const message = `Rappel : la date limite pour saisir le score de votre match contre ${opponent.firstName} ${opponent.lastName} est le ${deadlineStr}. Pensez à le renseigner avant cette échéance.`

        await prisma.notification.create({
          data: {
            userId: user.id, type: 'deadline_reminder', title: 'Rappel de deadline',
            message,
            opponentName: `${opponent.firstName} ${opponent.lastName}`,
            startDate: pm.scheduledDate, endDate: pm.deadlineAt,
            plannedMatchId: pm.id,
          },
        })
        sent++

        await prisma.schedulingLog.create({
          data: {
            phase: pm.phase, type: 'avertissement',
            message: `Rappel de deadline envoyé automatiquement à ${user.firstName} ${user.lastName} (@${user.username}) — match #${pm.id} vs ${opponent.firstName} ${opponent.lastName}, deadline ${deadlineStr}.`,
          },
        })
      }
    }

    return res.status(200).json({ ok: true, sent })
  } catch (err) {
    console.error('[cron-deadline-reminders]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
