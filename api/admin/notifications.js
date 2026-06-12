Write updated admin notifications.js with bulk sendbashcat > /home/claude/notifications_admin.js << 'EOF'
/**
 * api/admin/notifications.js
 *
 * POST /api/admin/notifications
 *   action: 'send'         → envoyer une notification à un ou plusieurs joueurs
 *   action: 'send_special' → organiser une rencontre spéciale (notifie 2 joueurs + crée SpecialMatch)
 *   action: 'delete'       → supprimer une notification
 *
 * GET /api/admin/notifications
 *   → liste toutes les notifications (avec statut de lecture)
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  // GET : lister toutes les notifications
  if (req.method === 'GET') {
    try {
      const notifications = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
      })
      return res.status(200).json({ notifications })
    } catch (err) {
      console.error('[admin/notifications GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  // ── send : notification simple (1 joueur ou plusieurs) ──
  if (action === 'send') {
    const { userId, userIds, title, message } = req.body
    if (!title || !message)
      return res.status(400).json({ error: 'title et message requis.' })

    // Construire la liste des IDs cibles
    let targetIds = []
    if (Array.isArray(userIds) && userIds.length > 0) {
      targetIds = userIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
    } else if (userId) {
      const uid = parseInt(userId, 10)
      if (!isNaN(uid)) targetIds = [uid]
    }

    if (targetIds.length === 0)
      return res.status(400).json({ error: 'Au moins un joueur requis.' })

    try {
      const created = []
      for (const uid of targetIds) {
        const user = await prisma.user.findUnique({ where: { id: uid } })
        if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase())) continue
        const notif = await prisma.notification.create({
          data: { userId: uid, type: 'message', title: title.trim(), message: message.trim() },
        })
        created.push(notif)
      }
      return res.status(201).json({ ok: true, count: created.length, notifications: created })
    } catch (err) {
      console.error('[admin/notifications send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── send_special : rencontre spéciale ──
  if (action === 'send_special') {
    const { player1Id, player2Id, startDate, endDate, reason, note, message } = req.body
    if (!player1Id || !player2Id || !startDate || !endDate || !reason)
      return res.status(400).json({ error: 'player1Id, player2Id, startDate, endDate, reason requis.' })

    const p1id = parseInt(player1Id, 10)
    const p2id = parseInt(player2Id, 10)
    if (isNaN(p1id) || isNaN(p2id) || p1id === p2id)
      return res.status(400).json({ error: 'Joueurs invalides ou identiques.' })

    const [p1, p2] = await Promise.all([
      prisma.user.findUnique({ where: { id: p1id } }),
      prisma.user.findUnique({ where: { id: p2id } }),
    ])
    if (!p1 || !p2) return res.status(404).json({ error: 'Un des joueurs est introuvable.' })
    if (ADMIN_USERNAMES.includes(p1.username.toLowerCase()) || ADMIN_USERNAMES.includes(p2.username.toLowerCase()))
      return res.status(403).json({ error: 'Impossible d\'impliquer un compte admin.' })

    try {
      const special = await prisma.specialMatch.create({
        data: {
          player1Id: p1id,
          player2Id: p2id,
          startDate: new Date(startDate),
          endDate:   new Date(endDate),
          reason:    reason.trim(),
          note:      note ? note.trim() : null,
        },
      })

      const customMsg = message ? message.trim() : ''
      const baseTitle = 'Rencontre organisée'
      const baseMsg   = `Vous êtes invité à affronter ${p2.firstName} ${p2.lastName}. À partir du ${new Date(startDate).toLocaleDateString('fr-FR')}, avant le ${new Date(endDate).toLocaleDateString('fr-FR')}. Motif : ${reason.trim()}.${customMsg ? ' ' + customMsg : ''}`
      const baseMsgP2 = `Vous êtes invité à affronter ${p1.firstName} ${p1.lastName}. À partir du ${new Date(startDate).toLocaleDateString('fr-FR')}, avant le ${new Date(endDate).toLocaleDateString('fr-FR')}. Motif : ${reason.trim()}.${customMsg ? ' ' + customMsg : ''}`

      const [n1, n2] = await Promise.all([
        prisma.notification.create({
          data: {
            userId: p1id, type: 'special_match', title: baseTitle,
            message: baseMsg,
            opponentName: `${p2.firstName} ${p2.lastName}`,
            startDate: new Date(startDate), endDate: new Date(endDate),
            reason: reason.trim(),
          },
        }),
        prisma.notification.create({
          data: {
            userId: p2id, type: 'special_match', title: baseTitle,
            message: baseMsgP2,
            opponentName: `${p1.firstName} ${p1.lastName}`,
            startDate: new Date(startDate), endDate: new Date(endDate),
            reason: reason.trim(),
          },
        }),
      ])

      return res.status(201).json({ ok: true, special, notifications: [n1, n2] })
    } catch (err) {
      console.error('[admin/notifications send_special]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── delete ──
  if (action === 'delete') {
    const { notificationId } = req.body
    const nid = parseInt(notificationId, 10)
    if (isNaN(nid)) return res.status(400).json({ error: 'notificationId invalide.' })
    try {
      await prisma.notification.delete({ where: { id: nid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/notifications delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou notification introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
EOF
echo "notifications_admin.js done"Outputnotifications_admin.js done
DoneMaintenant le gros du travail : le frontend index.html. Je vais le modifier section par section.Ran 12 commands


Copy index.html to working dir
bash

cp /mnt/user-data/uploads/index.html /home/claude/index.html
echo "copied"
Output

copied

Fix charte alignment
bash

# Fix 1: article-body ul li alignment - add padding-left on ul and adjust li
python3 -c "
import re

with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Fix ul alignment in article-body
old = '  .article-body ul { padding-left: 0; list-style: none; }\n  .article-body ul li { display: flex; gap: 0.75rem; align-items: flex-start; color: var(--gray-light); font-size: 0.95rem; padding: 0.5rem 0; border-bottom: 1px solid var(--dark4); line-height: 1.6; }'
new = '  .article-body ul { padding-left: 0; list-style: none; }\n  .article-body ul li { display: flex; gap: 0.75rem; align-items: flex-start; color: var(--gray-light); font-size: 0.95rem; padding: 0.5rem 0; border-bottom: 1px solid var(--dark4); line-height: 1.6; }\n  .article-body ul li > span, .article-body ul li > strong { flex: 1; }'

if old in content:
    content = content.replace(old, new)
    print('Fixed li span wrapping')
else:
    print('Pattern not found, trying alternative')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
"
Output

Fixed li span wrapping

Fix bold in charte and setDiff display
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Fix 2: Article 3 bold - "le dernier samedi" instead of "vainqueur"
old_art3 = '''          <li>À l'issue de l'affrontement, le <strong>vainqueur</strong> communique les scores à Yanis avant <strong>le dernier samedi</strong> de la période des deux semaines.</li>'''
new_art3 = '''          <li>À l'issue de l'affrontement, le vainqueur communique les scores à Yanis avant <strong>le dernier samedi</strong> de la période des deux semaines.</li>'''
if old_art3 in content:
    content = content.replace(old_art3, new_art3)
    print('Fixed article 3 bold')
else:
    print('Art3 pattern not found')

# Fix 3: Replace +X by X in setDiff display (renderRankingTable)
old_diff = "    const diff = p.setDiff > 0 ? '+' + p.setDiff : p.setDiff"
new_diff = "    const diff = p.setDiff"
if old_diff in content:
    content = content.replace(old_diff, new_diff)
    print('Fixed setDiff display')
else:
    print('setDiff pattern not found')

# Also fix showPlayerDetail setDiff
old_diff2 = "  const diff = player.setDiff > 0 ? '+' + player.setDiff : player.setDiff"
new_diff2 = "  const diff = player.setDiff"
if old_diff2 in content:
    content = content.replace(old_diff2, new_diff2)
    print('Fixed player detail setDiff')
else:
    print('player detail setDiff not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Fixed article 3 bold
Fixed setDiff display
Fixed player detail setDiff

Add admin tabs for planned matches and refused registrations
