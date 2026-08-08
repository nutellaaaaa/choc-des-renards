// api/cron-deadline-reminders.js
//
// Déclenché quotidiennement à 8h (voir vercel.json).
// Envoie des notifications aux joueurs dont la deadline de score approche dans
// les 48h. Ne s'exécute que si TournamentState.autoRemindersEnabled === true.
// Peut aussi être déclenché manuellement par l'admin via l'action
// "send_reminders_manual" dans admin.js (même logique, même filtres).
const { PrismaClient } = require('@prisma/client')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || ''
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Non autorisé.' })
    }
  }

  try {
    // Vérifier si les rappels automatiques sont activés
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    if (state && state.autoRemindersEnabled === false) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Rappels automatiques désactivés par l\'administrateur.' })
    }

    const now = new Date()
    const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    // Matchs planifiés avec deadline dans les 48h, déjà notifiés du match,
    // non forfaitisés, et sans score encore soumis
    const upcoming = await prisma.plannedMatch.findMany({
      where: {
        forfeited: false,
        notifiedAt: { not: null },
        deadlineAt: { gte: now, lte: deadline48h },
      },
      include: {
        player1: { select: { id: true, firstName: true, lastName: true, username: true } },
        player2: { select: { id: true, firstName: true, lastName: true, username: true } },
      },
    })

    let sent = 0
    const logs = []

    for (const pm of upcoming) {
      for (const { player, opponent } of [
        { player: pm.player1, opponent: pm.player2 },
        { player: pm.player2, opponent: pm.player1 },
      ]) {
        if (ADMIN_USERNAMES.includes(player.username.toLowerCase())) continue

        // Anti-spam : ne pas envoyer si un rappel a déjà été envoyé dans les 12 dernières heures
        const alreadySent = await prisma.notification.findFirst({
          where: {
            userId: player.id,
            plannedMatchId: pm.id,
            type: 'deadline_reminder',
            createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
          },
        })
        if (alreadySent) continue

        const deadlineStr = pm.deadlineAt
          ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(pm.deadlineAt)
          : 'bientôt'

        await prisma.notification.create({
          data: {
            userId: player.id,
            type: 'deadline_reminder',
            title: '⏰ Rappel : score à saisir',
            message: `Votre match contre ${opponent.firstName} ${opponent.lastName} doit être saisi avant le ${deadlineStr}. N'oubliez pas d'entrer votre score !`,
            opponentName: `${opponent.firstName} ${opponent.lastName}`,
            plannedMatchId: pm.id,
          },
        })
        sent++
        logs.push(`Rappel envoyé à ${player.firstName} ${player.lastName} (match #${pm.id} vs ${opponent.firstName} ${opponent.lastName})`)
      }
    }

    console.log(`[cron-deadline-reminders] ${sent} rappel(s) envoyé(s).`, logs)
    return res.status(200).json({ ok: true, sent, logs })
  } catch (err) {
    console.error('[cron-deadline-reminders]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
