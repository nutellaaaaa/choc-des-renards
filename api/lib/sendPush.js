/**
 * lib/sendPush.js
 *
 * Helper centralisé pour l'envoi de notifications push web.
 * Utilise la bibliothèque web-push avec les clés VAPID définies en env.
 *
 * Usage depuis admin.js (après prisma.notification.create) :
 *
 *   const { sendPushToUser } = require('../lib/sendPush')
 *   await sendPushToUser(prisma, targetUserId, {
 *     title: 'Nouveau message',
 *     body:  'L'admin vous a envoyé une notification.',
 *     tab:   'notifications',   // onglet CDR vers lequel naviguer au clic
 *   })
 *
 * Installation : npm install web-push
 * Génération des clés : npx web-push generate-vapid-keys
 * Variables d'env requises :
 *   VAPID_PUBLIC_KEY   — clé publique base64url
 *   VAPID_PRIVATE_KEY  — clé privée base64url
 *   VAPID_EMAIL        — ex: admin@lechocdesrenards.fr (contact pour les serveurs push)
 */

const webpush = require('web-push')

// Initialisation VAPID une seule fois au chargement du module
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${VAPID_EMAIL || 'admin@lechocdesrenards.fr'}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  )
} else {
  console.warn('[sendPush] Clés VAPID manquantes — push désactivé.')
}

/**
 * Envoie une notification push à toutes les subscriptions d'un utilisateur.
 *
 * @param {PrismaClient} prisma  — instance Prisma partagée
 * @param {number}       userId  — ID du joueur cible
 * @param {{ title: string, body: string, tab?: string }} payload
 */
async function sendPushToUser(prisma, userId, { title, body, tab = '' }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return // push non configuré

  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  if (!subs.length) return

  const payloadStr = JSON.stringify({ title, body, tab })

  await Promise.allSettled(
    subs.map(async row => {
      try {
        await webpush.sendNotification(JSON.parse(row.subscription), payloadStr)
      } catch (err) {
        // 410 Gone / 404 = subscription expirée → on la supprime proprement
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: row.id } }).catch(() => {})
          console.log(`[sendPush] Subscription expirée supprimée (userId=${userId})`)
        } else {
          console.error(`[sendPush] Erreur envoi userId=${userId}:`, err.statusCode, err.body)
        }
      }
    }),
  )
}

module.exports = { sendPushToUser }
