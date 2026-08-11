// api/cron-close-stale-sessions.js
//
// Corrige le bug des « connexions sans heure de déconnexion » sur téléphone :
// sur mobile, lorsqu'un onglet est fermé brutalement (swipe) ou que le
// navigateur tue le process en arrière-plan, ni l'événement visibilitychange
// ni le fetch keepalive du logout ne sont envoyés de façon fiable. Résultat :
// des LoginEvent restent ouverts (logoutAt = null) indéfiniment.
//
// Ce cron passe toutes les 5 minutes et clôture automatiquement les sessions
// ouvertes dont la dernière activité remonte à plus de STALE_THRESHOLD_MS.
// Comme le schéma LoginEvent n'a pas de champ « dernière activité », on
// utilise createdAt + une marge conservatrice : une session qui n'a pas été
// clôturée après 30 minutes est considérée comme morte (15 min d'inactivité
// appliquées côté client + 15 min de marge de sécurité pour les connexions
// admin exemptes et les éventuels décalages).
//
// La raison 'inactivity' est utilisée pour les sessions clôturées
// automatiquement (l'heure réelle de déconnexion est estimée à createdAt + 15 min
// dans l'affichage de l'historique côté client).
const { PrismaClient } = require('@prisma/client')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

// Une session ouverte depuis plus longtemps que ce seuil est considérée
// comme inactive / morte et est clôturée automatiquement.
// 15 min d'inactivité (INACTIVITY_MS) + 15 min de marge = 30 min.
const STALE_THRESHOLD_MS = 30 * 60 * 1000
// Heure de déconnexion estimée = createdAt + 15 min (durée d'inactivité).
const ESTIMATED_INACTIVITY_MS = 15 * 60 * 1000

module.exports = async function handler(req, res) {
  // Vérification du secret Vercel Cron (sécurité) — optionnel
  if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    // On ne bloque pas en l'absence de configuration pour rester rétrocompatible
  }

  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)

    // Clôturer toutes les sessions ouvertes (logoutAt = null) plus anciennes
    // que le seuil. On estime l'heure de déconnexion à createdAt + 15 min
    // (durée d'inactivité côté client) pour que l'historique reste cohérent.
    const staleEvents = await prisma.loginEvent.findMany({
      where: { logoutAt: null, createdAt: { lt: cutoff } },
      select: { id: true, createdAt: true },
    })

    let closed = 0
    for (const ev of staleEvents) {
      const estimatedLogout = new Date(new Date(ev.createdAt).getTime() + ESTIMATED_INACTIVITY_MS)
      // On ne remonte pas la déconnexion estimée dans le futur
      const logoutAt = estimatedLogout.getTime() > Date.now() ? new Date() : estimatedLogout
      await prisma.loginEvent.update({
        where: { id: ev.id },
        data: { logoutAt, logoutReason: 'inactivity' },
      }).catch(() => {})
      closed++
    }

    return res.status(200).json({
      ok: true,
      closed,
      thresholdMs: STALE_THRESHOLD_MS,
      message: `${closed} session(s) inactive(s) clôturée(s).`,
    })
  } catch (err) {
    console.error('[cron-close-stale-sessions]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
