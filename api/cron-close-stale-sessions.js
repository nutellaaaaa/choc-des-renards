// api/cron-close-stale-sessions.js
//
// Corrige le bug des « connexions sans heure de déconnexion » sur téléphone :
// sur mobile, lorsqu'un onglet est fermé brutalement (swipe) ou que le
// navigateur tue le process en arrière-plan, ni l'événement visibilitychange
// ni le fetch keepalive du logout ne sont envoyés de façon fiable. Résultat :
// des LoginEvent restent ouverts (logoutAt = null) indéfiniment.
//
// Ce cron s'exécute UNE FOIS PAR JOUR (à 3h du matin) — Vercel Hobby limite
// les cron jobs à une exécution quotidienne. À cette heure, toute session
// encore ouverte (logoutAt = null) est nécessairement morte : on les clôture
// toutes avec la raison 'inactivity'.
//
// NOTE : La déconnexion en temps réel (15 min d'inactivité) est gérée côté
// client (timer JS, heartbeat toutes les 5 min vers /api/login?action=me,
// pagehide, checkStaleSessionOnLoad). Ce cron est un filet de sécurité qui
// nettoie les sessions "fantômes" restées ouvertes (notamment sur mobile).
//
// L'heure de déconnexion est estimée à createdAt + 15 min (durée d'inactivité
// côté client) pour que l'historique reste cohérent.
const { PrismaClient } = require('@prisma/client')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

// Heure de déconnexion estimée = createdAt + 15 min (durée d'inactivité).
const ESTIMATED_INACTIVITY_MS = 15 * 60 * 1000

module.exports = async function handler(req, res) {
  // BUG FIX : ce bloc ne contenait aucun `return` — il ne bloquait donc jamais
  // rien, même avec CRON_SECRET configuré. N'importe qui pouvait déclencher la
  // clôture de toutes les sessions actives à n'importe quelle heure.
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || ''
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Non autorisé.' })
    }
  }

  try {
    // Clôturer TOUTES les sessions encore ouvertes (logoutAt = null).
    // À 3h du matin, n'importe quelle session sans logoutAt est forcément
    // inactive / morte — on les ferme toutes.
    const staleEvents = await prisma.loginEvent.findMany({
      where: { logoutAt: null },
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
      message: `${closed} session(s) inactive(s) clôturée(s).`,
    })
  } catch (err) {
    console.error('[cron-close-stale-sessions]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
