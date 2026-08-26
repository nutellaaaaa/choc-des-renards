/**
 * api/admin.js
 *
 * Fusion des anciennes routes :
 *   api/admin/contact.js
 *   api/admin/faq.js
 *   api/admin/history.js
 *   api/admin/notifications.js
 *   api/admin/phase.js
 *   api/admin/poules.js
 *   api/admin/action.js
 *   api/admin/match.js
 *
 * Routage via ?resource=contact|faq|history|notifications|phase|poules|action|match
 * (les rewrites dans vercel.json préservent les anciennes URLs, aucun
 * changement côté frontend n'est nécessaire)
 *
 * IMPORTANT : ce fichier doit être placé en api/admin.js (à la racine du
 * dossier api/, PAS dans un sous-dossier api/admin/), sinon Vercel le
 * route vers /api/admin/admin au lieu de /api/admin.
 */
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('./_auth')
const { logDeletion, restoreVersion } = require('./lib/dataVersion')
const { sendPushToUser } = require('./lib/sendPush')
const cheerio = require('cheerio')
const argon2 = require('argon2')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']
const VALID_CATEGORIES = ['N', 'R', 'D', 'P', 'NC']
const MYFFBAD_BASE = 'https://myffbad.fr/recherche/joueur?league=12&committee=67&club=2359&isFirstLoad=false'

// Format d'un hash Argon2 encodé (ex: $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>)
const ARGON2_HASH_REGEX = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/

const DEFAULT_MALUS_LIST = [
  'Interdiction de smasher ou de tendre droit',
  'Porter un cache-œil',
  'Interdiction de taper le volant au-dessus de la bande',
  'Jouer en demi-terrain pour le joueur le moins bien classé (le demi-terrain change selon le service en cours)',
  'Jouer avec une raquette courte',
  'Jouer avec une raquette lestée',
  'Jouer avec une raquette de précision',
  'Jouer avec un bras dans le dos constamment',
  'Interdiction de faire un coup droit',
  'Interdiction de faire un revers',
  'Annoncer chaque coup à voix haute avant de le jouer',
  'Les couloirs font partie du terrain du joueur le plus classé',
  'Les points du joueur le moins classé comptent double',
  'Le point est marqué par le joueur le mieux classé uniquement s\'il touche le sol avant la raquette de l\'adversaire',
  'Le joueur le moins classé marque le point',
  'Zone restrictive changeant à chaque set : rivière, box, couloir du fond, box puis rivière',
]
// Alias rétrocompatible (utilisé dans les endroits qui lisent MALUS_LIST statiquement)
let MALUS_LIST = [...DEFAULT_MALUS_LIST]

/**
 * Vérifie si un onglet est visible pour les utilisateurs (non masqué par l'admin).
 * Utilisé pour conditionner l'envoi de notifications push liées à des onglets
 * cachés : si la vitrine, les performances, etc. sont masqués, on ne notifie pas.
 * @param {string} tabKey — clé de l'onglet (ex: 'vitrine', 'performances', 'score')
 */
async function isTabVisible(tabKey) {
  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    const hiddenTabs = JSON.parse(state?.hiddenTabs || '[]')
    return !hiddenTabs.includes(tabKey)
  } catch { return true } // en cas d'erreur, on notifie quand même
}

/** Charge la liste des malus depuis la DB (malusConfig). Retourne DEFAULT_MALUS_LIST si vide.
 *  Le format stocké peut être un tableau de strings (ancien) ou d'objets {text, enabled, maxConcurrent}.
 *  Cette fonction retourne uniquement les malus actifs (enabled !== false), sous forme de strings. */
async function loadMalusList() {
  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    if (state?.malusConfig) {
      const cfg = JSON.parse(state.malusConfig)
      if (Array.isArray(cfg) && cfg.length > 0) {
        // Nouveau format : [{text, enabled, maxConcurrent}]
        if (cfg[0] && typeof cfg[0] === 'object' && 'text' in cfg[0]) {
          return cfg.filter(m => m.enabled !== false).map(m => m.text)
        }
        // Ancien format : strings — rétrocompatible
        return cfg
      }
    }
  } catch {}
  return DEFAULT_MALUS_LIST
}

/** Charge la liste complète des malus (avec enabled et maxConcurrent) depuis la DB.
 *  Retourne DEFAULT_MALUS_LIST.map(t => ({text, enabled, maxConcurrent: null})) si vide. */
async function loadMalusConfigFull() {
  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    if (state?.malusConfig) {
      const cfg = JSON.parse(state.malusConfig)
      if (Array.isArray(cfg) && cfg.length > 0) {
        if (cfg[0] && typeof cfg[0] === 'object' && 'text' in cfg[0]) {
          return cfg.map(m => ({ text: m.text, enabled: m.enabled !== false, maxConcurrent: m.maxConcurrent || null }))
        }
        return cfg.map(t => ({ text: t, enabled: true, maxConcurrent: null }))
      }
    }
  } catch {}
  return DEFAULT_MALUS_LIST.map(t => ({ text: t, enabled: true, maxConcurrent: null }))
}

/**
 * Applique les limites d'utilisation simultanée des malus (maxConcurrent).
 * Pour chaque malus ayant une limite > 0, compte combien de matchs planifiés
 * actifs (non forfeited) l'utilisent. Si le nombre dépasse la limite, réassigne
 * le surplus vers d'autres malus actifs sans limite (ou dont la limite n'est pas atteinte).
 * Retourne le nombre de matchs réassignés.
 */
// BUG FIX : retourne logMessages au lieu d'écrire en DB directement —
// le flushLogs() de computePhase1/2 effaçait aussitôt les messages écrits ici.
async function enforceMalusConcurrency(malusConfig) {
  const logMessages = []
  if (!Array.isArray(malusConfig)) return { reassigned: 0, logMessages }
  const limited = malusConfig.filter(m => m.enabled !== false && m.maxConcurrent && m.maxConcurrent > 0)
  if (limited.length === 0) return { reassigned: 0, logMessages }
  const activeTexts = malusConfig.filter(m => m.enabled !== false).map(m => m.text)
  if (activeTexts.length === 0) return { reassigned: 0, logMessages }
  const activeMatches = await prisma.plannedMatch.findMany({
    where: { forfeited: false, malus: { not: null } },
    include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  let reassigned = 0
  for (const malus of limited) {
    const usingThis = activeMatches.filter(m => m.malus === malus.text)
    if (usingThis.length <= malus.maxConcurrent) continue
    const surplus = usingThis.slice(malus.maxConcurrent)
    const replacementPool = activeTexts.filter(t => {
      if (t === malus.text) return false
      const cfg = malusConfig.find(m => m.text === t)
      if (!cfg || cfg.enabled === false) return false
      if (cfg.maxConcurrent && cfg.maxConcurrent > 0) {
        return activeMatches.filter(m => m.malus === t).length < cfg.maxConcurrent
      }
      return true
    })
    if (replacementPool.length === 0) {
      for (const pm of surplus) {
        logMessages.push({ phase: pm.phase, type: 'avertissement', message: `Limite de concurrence atteinte pour le malus « ${malus.text} » (${malus.maxConcurrent} max) — impossible de réassigner le match #${pm.id} : aucun malus de remplacement disponible.` })
        await createAdminAlert('malus_reassign_failed', `Limite atteinte pour le malus « ${malus.text} » (${malus.maxConcurrent} max) — impossible de réassigner le match #${pm.id}.`, { plannedMatchId: pm.id, malus: malus.text })
      }
      continue
    }
    for (const pm of surplus) {
      const counts = replacementPool.map(t => ({ text: t, count: activeMatches.filter(m => m.malus === t).length }))
      counts.sort((a, b) => a.count - b.count)
      const newMalus = counts[0].text
      await prisma.plannedMatch.update({ where: { id: pm.id }, data: { malus: newMalus } })
      pm.malus = newMalus
      logMessages.push({ phase: pm.phase, type: 'avertissement', message: `Malus réassigné pour le match #${pm.id} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) : limite « ${malus.text} » (${malus.maxConcurrent} max) atteinte. Nouveau malus : « ${newMalus} ».` })
      await createAdminAlert('malus_reassigned', `Malus réassigné pour le match #${pm.id} : « ${malus.text} » → « ${newMalus} ».`, { plannedMatchId: pm.id, oldMalus: malus.text, newMalus })
      reassigned++
    }
  }
  return { reassigned, logMessages }
}

/**
 * Vérifie si un malus donné peut être assigné à un nouveau match sans dépasser
 * sa limite de concurrence. Retourne true si l'assignation est possible.
 */
async function canAssignMalus(malusText) {
  if (!malusText) return true
  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
    if (!state?.malusConfig) return true
    const cfg = JSON.parse(state.malusConfig)
    if (!Array.isArray(cfg)) return true
    const entry = cfg.find(m => m.text === malusText)
    if (!entry || entry.enabled === false) return true // malus non limité ou désactivé = pas de restriction
    if (!entry.maxConcurrent || entry.maxConcurrent <= 0) return true
    // Compter les matchs actifs utilisant ce malus
    const count = await prisma.plannedMatch.count({
      where: { forfeited: false, malus: malusText },
    })
    return count < entry.maxConcurrent
  } catch { return true }
}

/**
 * Choisit un malus aléatoire en respectant les limites de concurrence.
 * Si aucun malus avec limite disponible, tombe sur un malus sans limite.
 */
async function pickRandomMalusWithConcurrency(malusList) {
  const available = []
  for (const malus of malusList) {
    if (await canAssignMalus(malus)) available.push(malus)
  }
  if (available.length === 0) return malusList[Math.floor(Math.random() * malusList.length)]
  return available[Math.floor(Math.random() * available.length)]
}

// Rang de classement, du plus faible au plus fort (FFBad) — utilisé pour le malus automatique
const CATEGORY_RANK = { NC: 0, P: 1, D: 2, R: 3, N: 4 }
// Écarts de classement qui déclenchent un malus automatique pour compenser l'écart
// N/DC → N vs NC ; D/NC ; P/NC ajoutés en plus de P/R, P/N, D/N
const AUTO_MALUS_PAIRS = [['P', 'R'], ['P', 'N'], ['D', 'N'], ['N', 'NC'], ['D', 'NC'], ['P', 'NC']]

function pickRandomMalus(list) {
  const src = list || MALUS_LIST
  return src[Math.floor(Math.random() * src.length)]
}

/**
 * Calcule un malus automatique si l'écart de classement entre les deux joueurs
 * correspond à un des écarts significatifs. Le malus est attribué
 * au joueur le mieux classé pour compenser l'écart. Retourne null si aucun écart
 * qualifiant n'est trouvé.
 */
function computeAutoMalus(cat1, cat2, list) {
  const c1 = cat1 || 'NC', c2 = cat2 || 'NC'
  const qualifies = AUTO_MALUS_PAIRS.some(([a, b]) => (c1 === a && c2 === b) || (c1 === b && c2 === a))
  if (!qualifies) return null
  const r1 = CATEGORY_RANK[c1] ?? 0
  const r2 = CATEGORY_RANK[c2] ?? 0
  const target = r1 >= r2 ? 1 : 2 // 1 = player1, 2 = player2 — au mieux classé
  return { malus: pickRandomMalus(list), malusTarget: target }
}

/** Crée une alerte admin en base (non bloquant). */
async function createAdminAlert(type, message, meta) {
  try {
    await prisma.adminAlert.create({ data: { type, message, meta: meta || null } })
  } catch (e) { console.error('[adminAlert]', e) }
}

// Met en forme "jean-pierre" / "JEAN" / "jEan" → "Jean-Pierre" (gère espaces et tirets)
function capName(str) {
  if (!str) return str
  return str.toString().trim().split(/(\s|-)/).map(part =>
    /^[\s-]$/.test(part) ? part : (part.charAt(0).toLocaleUpperCase('fr-FR') + part.slice(1).toLocaleLowerCase('fr-FR'))
  ).join('')
}

// Garde-fou serveur : les sets se jouent en 11 points secs (charte, article 3),
// donc un score de set ne doit jamais dépasser 11. Retourne un message
// d'erreur si un set est invalide, ou null si tout est correct.
function validateSetScores(sets) {
  for (const s of sets) {
    const ps = Number(s.playerScore), os = Number(s.opponentScore)
    if (!Number.isFinite(ps) || !Number.isFinite(os) || ps < 0 || os < 0 || ps > 11 || os > 11) {
      return 'Chaque score de set doit être compris entre 0 et 11 points.'
    }
  }
  return null
}

function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0, points = 0
  for (const m of matches) {
    const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
    const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++; setDiff += pw - ow
    // BUG FIX : bye "comptabilisé comme défaite" doit valoir 0 point pas 1.
    const isByeLoss = m.opponentFirstName === 'Exempt' && m.opponentLastName === '(bye)' && !(pw > ow)
    if (pw > ow) { wins++; points += 3 } else { losses++; points += isByeLoss ? 0 : 1 }
  }
  return { played, wins, losses, setDiff, points }
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.played !== b.played) return a.played - b.played
    if (b.points !== a.points) return b.points - a.points
    // BUG FIX : tiebreak par catégorie (règle documentée), pas par date d'inscription.
    const rankA = CATEGORY_RANK[a.category] ?? 0
    const rankB = CATEGORY_RANK[b.category] ?? 0
    if (rankA !== rankB) return rankA - rankB
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
}

// Normalise une chaîne pour comparaison de noms (minuscule, sans accents, sans espaces/ponctuation)
function normName(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

// Scrape toutes les pages du club sur MYFFBAD et renvoie { scraped, logs }
async function scrapeMyffbadClub() {
  const logs = []
  const scraped = []
  const MAX_PAGES = 15

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${MYFFBAD_BASE}&page=${page}`
    let html
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CDR-bot/1.0)' },
      })
      if (!r.ok) {
        logs.push({ ok: false, message: `Page ${page} : échec HTTP ${r.status}.` })
        break
      }
      html = await r.text()
    } catch (e) {
      logs.push({ ok: false, message: `Page ${page} : erreur réseau (${e.message}).` })
      break
    }

    const $ = cheerio.load(html)
    const rows = $('table tbody tr')
    if (rows.length === 0) {
      logs.push({ ok: true, message: `Page ${page} : aucune ligne — fin de la pagination.` })
      break
    }

    let countOnPage = 0
    rows.each((i, tr) => {
      const tds = $(tr).find('td')
      if (tds.length < 5) return
      const fullName = $(tds[0]).text().trim().replace(/\s+/g, ' ')
      if (!fullName) return
      const sdmText = $(tds[4]).text().trim()
      const tokens = sdmText.split(/\s+/).filter(Boolean)
      const simpleToken = tokens[0] || ''
      scraped.push({ fullName, simpleToken })
      countOnPage++
    })
    logs.push({ ok: true, message: `Page ${page} : ${countOnPage} joueur(s) récupéré(s).` })

    if (countOnPage === 0) break
  }

  return { scraped, logs }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { resource } = req.query || {}

  switch (resource) {
    case 'contact':
      return handleContact(req, res)
    case 'faq':
      return handleFaq(req, res)
    case 'history':
      return handleHistory(req, res)
    case 'notifications':
      return handleNotifications(req, res)
    case 'phase':
      return handlePhase(req, res)
    case 'poules':
      return handlePoules(req, res)
    case 'action':
      return handleAction(req, res)
    case 'match':
      return handleMatch(req, res)
    case 'scheduling':
      return handleScheduling(req, res)
    case 'bots':
      return handleBots(req, res)
    case 'alerts':
      return handleAlerts(req, res)
    case 'whatsapp':
      return handleWhatsapp(req, res)
    case 'medals':
      return handleMedals(req, res)
    case 'site_update':
      return handleSiteUpdate(req, res)
    case 'charte':
      return handleCharte(req, res)
    default:
      return res.status(400).json({ error: 'resource invalide ou manquant.' })
  }
}

/* ============================================================
 * CONTACT — historique des prises de contact (ex admin/contact.js)
 * ============================================================ */
async function handleContact(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const messages = await prisma.contactMessage.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
      })
      return res.status(200).json({ messages })
    } catch (err) {
      console.error('[admin/contact GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, contactId, treated } = req.body || {}
  const cid = parseInt(contactId, 10)

  if (action === 'mark_treated') {
    if (isNaN(cid)) return res.status(400).json({ error: 'contactId invalide.' })
    try {
      const updated = await prisma.contactMessage.update({
        where: { id: cid },
        data: { treated: !!treated },
      })
      return res.status(200).json({ ok: true, contact: updated })
    } catch (err) {
      console.error('[admin/contact mark_treated]', err)
      return res.status(500).json({ error: 'Erreur serveur ou message introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * FAQ — gestion des sujets FAQ (ex admin/faq.js)
 * ============================================================ */
async function handleFaq(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      if (req.query.history === '1') {
        const tid = parseInt(req.query.topicId, 10)
        if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })

        const limit = Math.min(parseInt(req.query.limit || '300', 10), 500)
        const views = await prisma.faqView.findMany({
          where: { topicId: tid },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } },
        })
        return res.status(200).json({ views })
      }

      const topics = await prisma.faqTopic.findMany({
        orderBy: { order: 'asc' },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ topics })
    } catch (err) {
      console.error('[admin/faq GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  function sanitizeItems(items) {
    if (!Array.isArray(items)) return null
    const cleaned = items
      .map(it => ({
        subtitle: it?.subtitle && String(it.subtitle).trim() ? String(it.subtitle).trim() : null,
        content: it?.content ? String(it.content).trim() : '',
      }))
      .filter(it => it.content.length > 0)
    return cleaned
  }

  if (action === 'create') {
    const { question } = req.body
    const items = sanitizeItems(req.body.items)
    if (!question?.trim()) return res.status(400).json({ error: 'La question (titre) est requise.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const maxOrder = await prisma.faqTopic.aggregate({ _max: { order: true } })
      const topic = await prisma.faqTopic.create({
        data: {
          question: question.trim(),
          order: (maxOrder._max.order ?? -1) + 1,
          items: {
            create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })),
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(201).json({ ok: true, topic })
    } catch (err) {
      console.error('[admin/faq create]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'update') {
    const { topicId, question } = req.body
    const tid = parseInt(topicId, 10)
    const items = sanitizeItems(req.body.items)
    if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })
    if (!question?.trim()) return res.status(400).json({ error: 'La question (titre) est requise.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const existing = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!existing) return res.status(404).json({ error: 'Sujet introuvable.' })

      await prisma.$transaction([
        prisma.faqItem.deleteMany({ where: { topicId: tid } }),
        prisma.faqTopic.update({
          where: { id: tid },
          data: {
            question: question.trim(),
            items: { create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })) },
          },
        }),
      ])

      const topic = await prisma.faqTopic.findUnique({
        where: { id: tid },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ ok: true, topic })
    } catch (err) {
      console.error('[admin/faq update]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete') {
    const { topicId } = req.body
    const tid = parseInt(topicId, 10)
    if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'FAQ_TOPIC', [tid])
        await tx.faqTopic.delete({ where: { id: tid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[admin/faq delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou sujet introuvable.' })
    }
  }

  if (action === 'toggle_publish') {
    const { topicId } = req.body
    const tid = parseInt(topicId, 10)
    if (isNaN(tid)) return res.status(400).json({ error: 'topicId invalide.' })
    try {
      const existing = await prisma.faqTopic.findUnique({ where: { id: tid } })
      if (!existing) return res.status(404).json({ error: 'Sujet introuvable.' })
      const updated = await prisma.faqTopic.update({
        where: { id: tid },
        data: { published: !existing.published },
      })
      return res.status(200).json({ ok: true, published: updated.published })
    } catch (err) {
      console.error('[admin/faq toggle_publish]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'reorder') {
    const { order } = req.body
    if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ error: 'order requis.' })
    try {
      await prisma.$transaction(
        order.map((id, i) => {
          const tid = parseInt(id, 10)
          return prisma.faqTopic.update({ where: { id: tid }, data: { order: i } })
        })
      )
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/faq reorder]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * CHARTE — articles éditables de la page Charte (même système que
 * la FAQ : titre + paragraphes ordonnés), affichés en lecture seule
 * sous la visionneuse PDF. ex. admin/charte.js
 * ============================================================ */

// Contenu d'origine (auparavant codé en dur dans le HTML), utilisé comme
// seed automatique la toute première fois que l'admin consulte cet onglet
// (si la table est vide), pour ne rien perdre lors de la migration.
const CHARTE_SEED = [
  {
    title: 'Participation',
    items: [
      { subtitle: null, content: "Tout adhérent·e au club de Bondy est libre de s'inscrire gratuitement au Choc des Renards auprès de Yanis.\n\nChaque joueur participant au choc est réputé accepter les termes de cette charte." },
    ],
  },
  {
    title: 'Déroulement',
    items: [
      { subtitle: null, content: "Le Choc des Renards s'organise en deux phases :\n- **Phase 1 — Septembre à Janvier :** l'ensemble des joueurs est réparti dans des poules. À l'issue, les joueurs sont séparés en deux groupes selon leur classement dans leur poule.\n- **Phase 2 — Février à Juin :** format phases finales en ronde suisse." },
    ],
  },
  {
    title: 'Format des affrontements',
    items: [
      { subtitle: null, content: "- Les joueurs reçoivent par message le numéro de téléphone et le nom de leur adversaire **un dimanche**.\n- Ils ont **deux semaines** à compter de ce jour pour effectuer leur match.\n- Le match se déroule en **3 sets gagnants de 11 points secs** (sans points d'écart). Pas de pause pendant le set. Un changement de côté est réalisé à chaque set.\n- Les volants sont fournis par les joueurs ou empruntés dans les caisses. Les autres modalités suivent le règlement officiel de la FFBAD.\n- À l'issue de l'affrontement, le vainqueur communique les scores à Yanis avant **le dernier samedi** de la période des deux semaines." },
    ],
  },
  {
    title: 'Bonus & Malus',
    items: [
      { subtitle: null, content: "Afin d'équilibrer certains affrontements, des **désavantages** seront attribués au joueur le mieux classé dans les cas suivants : **P contre R**, **P contre N** ou **D contre N**.\n\nLe malus est tiré au sort parmi la liste suivante :\n- Interdiction de smasher ou de tendre droit\n- Porter un cache-œil\n- Interdiction de taper le volant au-dessus de la bande\n- Jouer en demi-terrain pour le joueur le moins bien classé (le demi-terrain change selon le service en cours)\n- Jouer avec une raquette courte\n- Jouer avec une raquette lestée\n- Jouer avec une raquette de précision\n- Jouer avec un bras dans le dos constamment\n- Interdiction de faire un coup droit\n- Interdiction de faire un revers\n- Annoncer chaque coup à voix haute avant de le jouer\n- Les couloirs font partie du terrain du joueur le plus classé\n- Les points du joueur le moins classé comptent double\n- Le point est marqué par le joueur le mieux classé uniquement s'il touche le sol avant la raquette de l'adversaire\n- Le joueur le moins classé marque le point\n- Zone restrictive changeant à chaque set : rivière, box, couloir du fond, box puis rivière" },
    ],
  },
  {
    title: 'Exemptions',
    items: [
      { subtitle: null, content: "Dans des cas rares (voyage, blessure, maladie, décès…), un affrontement peut être annulé. L'organisation sera très reconnaissante d'être prévenue le plus tôt possible.\n\n**Aucun affrontement** ne sera réalisé durant les **vacances scolaires**." },
    ],
  },
]

async function seedCharteIfEmpty() {
  const count = await prisma.charteArticle.count()
  if (count > 0) return
  for (let i = 0; i < CHARTE_SEED.length; i++) {
    const a = CHARTE_SEED[i]
    await prisma.charteArticle.create({
      data: {
        title: a.title,
        order: i,
        items: { create: a.items.map((it, j) => ({ subtitle: it.subtitle, content: it.content, order: j })) },
      },
    })
  }
}

async function handleCharte(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      await seedCharteIfEmpty()
      const articles = await prisma.charteArticle.findMany({
        orderBy: { order: 'asc' },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ articles })
    } catch (err) {
      console.error('[admin/charte GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  function sanitizeItems(items) {
    if (!Array.isArray(items)) return null
    const cleaned = items
      .map(it => ({
        subtitle: it?.subtitle && String(it.subtitle).trim() ? String(it.subtitle).trim() : null,
        content: it?.content ? String(it.content).trim() : '',
      }))
      .filter(it => it.content.length > 0)
    return cleaned
  }

  if (action === 'create') {
    const { title } = req.body
    const items = sanitizeItems(req.body.items)
    if (!title?.trim()) return res.status(400).json({ error: 'Le titre est requis.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const maxOrder = await prisma.charteArticle.aggregate({ _max: { order: true } })
      const article = await prisma.charteArticle.create({
        data: {
          title: title.trim(),
          order: (maxOrder._max.order ?? -1) + 1,
          items: {
            create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })),
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(201).json({ ok: true, article })
    } catch (err) {
      console.error('[admin/charte create]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'update') {
    const { articleId, title } = req.body
    const aid = parseInt(articleId, 10)
    const items = sanitizeItems(req.body.items)
    if (isNaN(aid)) return res.status(400).json({ error: 'articleId invalide.' })
    if (!title?.trim()) return res.status(400).json({ error: 'Le titre est requis.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })

    try {
      const existing = await prisma.charteArticle.findUnique({ where: { id: aid } })
      if (!existing) return res.status(404).json({ error: 'Article introuvable.' })

      await prisma.$transaction([
        prisma.charteArticleItem.deleteMany({ where: { articleId: aid } }),
        prisma.charteArticle.update({
          where: { id: aid },
          data: {
            title: title.trim(),
            items: { create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })) },
          },
        }),
      ])

      const article = await prisma.charteArticle.findUnique({
        where: { id: aid },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ ok: true, article })
    } catch (err) {
      console.error('[admin/charte update]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete') {
    const { articleId } = req.body
    const aid = parseInt(articleId, 10)
    if (isNaN(aid)) return res.status(400).json({ error: 'articleId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'CHARTE_ARTICLE', [aid])
        await tx.charteArticle.delete({ where: { id: aid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[admin/charte delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou article introuvable.' })
    }
  }

  if (action === 'reorder') {
    const { order } = req.body
    if (!Array.isArray(order) || order.length === 0) return res.status(400).json({ error: 'order requis.' })
    try {
      await prisma.$transaction(
        order.map((id, i) => {
          const aid = parseInt(id, 10)
          return prisma.charteArticle.update({ where: { id: aid }, data: { order: i } })
        })
      )
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/charte reorder]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * SITE UPDATE — "Mise à jour du site" : annonce plein écran
 * bloquante affichée aux joueurs avant accès au site.
 * ============================================================ */
async function handleSiteUpdate(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const updates = await prisma.siteUpdate.findMany({
        orderBy: { createdAt: 'desc' },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ updates })
    } catch (err) {
      console.error('[admin/site_update GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  function sanitizeItems(items) {
    if (!Array.isArray(items)) return null
    const cleaned = items
      .map(it => ({
        subtitle: it?.subtitle && String(it.subtitle).trim() ? String(it.subtitle).trim() : null,
        content: it?.content ? String(it.content).trim() : '',
      }))
      .filter(it => it.content.length > 0)
    return cleaned
  }

  // Valide/normalise le couple (instant, scheduledAt) envoyé par le client.
  // Retourne { ok:false, error } ou { ok:true, instant, scheduledAt }.
  function resolveDeployTiming(body) {
    const instant = !!body.instant
    if (instant) return { ok: true, instant: true, scheduledAt: null }
    if (!body.scheduledAt) return { ok: false, error: 'Une date et une heure de déploiement sont requises pour une mise à jour programmée.' }
    const d = new Date(body.scheduledAt)
    if (isNaN(d.getTime())) return { ok: false, error: 'Date de déploiement invalide.' }
    return { ok: true, instant: false, scheduledAt: d }
  }

  if (action === 'create') {
    const { title } = req.body
    const items = sanitizeItems(req.body.items)
    if (!title?.trim()) return res.status(400).json({ error: 'Le titre est requis.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })
    const timing = resolveDeployTiming(req.body)
    if (!timing.ok) return res.status(400).json({ error: timing.error })

    try {
      const update = await prisma.siteUpdate.create({
        data: {
          title: title.trim(),
          instant: timing.instant,
          scheduledAt: timing.scheduledAt,
          items: {
            create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })),
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(201).json({ ok: true, update })
    } catch (err) {
      console.error('[admin/site_update create]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'update') {
    const { updateId, title } = req.body
    const uid = parseInt(updateId, 10)
    const items = sanitizeItems(req.body.items)
    if (isNaN(uid)) return res.status(400).json({ error: 'updateId invalide.' })
    if (!title?.trim()) return res.status(400).json({ error: 'Le titre est requis.' })
    if (!items || items.length === 0) return res.status(400).json({ error: 'Au moins un paragraphe est requis.' })
    const timing = resolveDeployTiming(req.body)
    if (!timing.ok) return res.status(400).json({ error: timing.error })

    try {
      const existing = await prisma.siteUpdate.findUnique({ where: { id: uid } })
      if (!existing) return res.status(404).json({ error: 'Mise à jour introuvable.' })

      await prisma.$transaction([
        prisma.siteUpdateItem.deleteMany({ where: { updateId: uid } }),
        prisma.siteUpdate.update({
          where: { id: uid },
          data: {
            title: title.trim(),
            instant: timing.instant,
            scheduledAt: timing.scheduledAt,
            items: { create: items.map((it, i) => ({ subtitle: it.subtitle, content: it.content, order: i })) },
          },
        }),
      ])

      const update = await prisma.siteUpdate.findUnique({
        where: { id: uid },
        include: { items: { orderBy: { order: 'asc' } } },
      })
      return res.status(200).json({ ok: true, update })
    } catch (err) {
      console.error('[admin/site_update update]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete') {
    const { updateId } = req.body
    const uid = parseInt(updateId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'updateId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'SITE_UPDATE', [uid])
        await tx.siteUpdate.delete({ where: { id: uid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[admin/site_update delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou mise à jour introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * HISTORY — historique des connexions (ex admin/history.js)
 * ============================================================ */
async function handleHistory(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  const limit = Math.min(parseInt(req.query?.limit || '200', 10), 500)
  const filterUserId = req.query?.userId ? parseInt(req.query.userId, 10) : null

  try {
    const where = filterUserId && !isNaN(filterUserId) ? { userId: filterUserId } : {}

    const events = await prisma.loginEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
    })

    return res.status(200).json({ events })
  } catch (err) {
    console.error('[admin/history]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * NOTIFICATIONS (admin) — envoi / suppression (ex admin/notifications.js)
 * ============================================================ */
async function handleNotifications(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

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

  if (action === 'send') {
    const { userId, userIds, title, message } = req.body
    if (!title || !message)
      return res.status(400).json({ error: 'title et message requis.' })

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
        // Push téléphone — onglet "messages" toujours visible
        // ⚠️ DOIT être await-é : Vercel termine la fonction dès que res.json() est appelé,
        // un fire-and-forget (.catch seul) serait tué avant que le push ne parte.
        await sendPushToUser(prisma, uid, { title: title.trim(), body: message.trim(), tab: 'notifications' }).catch(() => {})
      }
      return res.status(201).json({ ok: true, count: created.length, notifications: created })
    } catch (err) {
      console.error('[admin/notifications send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

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

  if (action === 'delete') {
    const { notificationId } = req.body
    const nid = parseInt(notificationId, 10)
    if (isNaN(nid)) return res.status(400).json({ error: 'notificationId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'NOTIFICATION', [nid])
        await tx.notification.delete({ where: { id: nid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[admin/notifications delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou notification introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * WHATSAPP — templates personnalisables + génération/gestion des boutons
 * d'envoi WhatsApp (liens wa.me), affichés dans l'onglet admin
 * "Communication WhatsApp". Un WhatsappMessage = un bouton en attente
 * d'envoi (ou déjà envoyé/marqué comme tel), jamais envoyé automatiquement
 * par le serveur : c'est l'admin qui clique et ouvre WhatsApp lui-même.
 * ============================================================ */

const WHATSAPP_VARS = [
  'nom',
  'prénom',
  'pseudo',
  'tel',
  "date du prochain match de l'utilisateur",
  "nom et prénom et classement de l'adversaire du prochain match de l'utilisateur",
  'date de début du duel',
  "date limite pour remplir le score du prochain match de l'utilisateur",
  "date limite de remplissage de score qui n'a pas été respectée",
  'potentiel malus pour le joueur lors de son prochain match',
]

const WHATSAPP_DEFAULT_TEMPLATES = {
  next_match: `Bonjour [prénom], vous affrontez [nom et prénom et classement de l'adversaire du prochain match de l'utilisateur] le [date du prochain match de l'utilisateur]. Merci de saisir votre score avant le [date limite pour remplir le score du prochain match de l'utilisateur]. 🦊`,
  reminder: `Bonjour [prénom], il vous reste peu de temps pour saisir le score de votre match contre [nom et prénom et classement de l'adversaire du prochain match de l'utilisateur] ! Deadline : [date limite pour remplir le score du prochain match de l'utilisateur]. ⏰`,
}

function describeMalusForUser(pm, userId) {
  if (!pm || !pm.malus) return 'aucun'
  const isTarget = (pm.malusTarget === 1 && pm.player1Id === userId) || (pm.malusTarget === 2 && pm.player2Id === userId)
  return isTarget ? pm.malus : 'aucun (le malus concerne l\'adversaire)'
}

/** Dictionnaire de variables pour un joueur donné, à partir de son "prochain
 *  match" planifié (pm peut être null → variables associées à '—'). */
function buildWhatsappVars(user, pm, opponent) {
  return {
    'nom': user.lastName,
    'prénom': user.firstName,
    'pseudo': user.username,
    'tel': user.phone || '—',
    "date du prochain match de l'utilisateur": pm?.scheduledDate ? fmtDate(pm.scheduledDate) : '—',
    "nom et prénom et classement de l'adversaire du prochain match de l'utilisateur": opponent ? `${opponent.firstName} ${opponent.lastName} (${opponent.category || 'NC'})` : '—',
    'date de début du duel': pm?.scheduledDate ? fmtDate(pm.scheduledDate) : '—',
    "date limite pour remplir le score du prochain match de l'utilisateur": pm?.deadlineAt ? fmtDateTime(pm.deadlineAt) : '—',
    "date limite de remplissage de score qui n'a pas été respectée": (pm?.forfeited && pm?.deadlineAt) ? fmtDateTime(pm.deadlineAt) : '—',
    'potentiel malus pour le joueur lors de son prochain match': describeMalusForUser(pm, user.id),
  }
}

function renderWhatsappTemplate(template, vars) {
  return template.replace(/\[([^\]]+)\]/g, (full, key) => (key in vars ? vars[key] : full))
}

async function getWhatsappTemplate(type) {
  const row = await prisma.whatsappTemplate.findUnique({ where: { type } })
  return row?.content || WHATSAPP_DEFAULT_TEMPLATES[type] || ''
}

// Accepte '06 12 34 56 78', '+33612345678', '0033612345678'… → '336...' (format wa.me, sans +)
function normalizePhoneForWa(phone) {
  if (!phone) return null
  let digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = '33' + digits.slice(1) // France par défaut
  return digits || null
}

async function handleWhatsapp(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [messages, templateRows] = await Promise.all([
        prisma.whatsappMessage.findMany({
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
        }),
        prisma.whatsappTemplate.findMany(),
      ])
      const templates = {}
      for (const type of ['next_match', 'reminder']) {
        const row = templateRows.find(t => t.type === type)
        templates[type] = row?.content ?? WHATSAPP_DEFAULT_TEMPLATES[type]
      }
      return res.status(200).json({ messages, templates, variables: WHATSAPP_VARS })
    } catch (err) {
      console.error('[admin/whatsapp GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'save_template') {
    const { type, content } = req.body || {}
    if (!['next_match', 'reminder'].includes(type)) return res.status(400).json({ error: 'type invalide.' })
    if (!content || !content.trim()) return res.status(400).json({ error: 'Contenu requis.' })
    try {
      const row = await prisma.whatsappTemplate.upsert({
        where: { type },
        update: { content: content.trim() },
        create: { type, content: content.trim() },
      })
      return res.status(200).json({ ok: true, template: row, message: 'Modèle enregistré.' })
    } catch (err) {
      console.error('[admin/whatsapp save_template]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Génère les boutons "prochain match" pour tous les joueurs éligibles —
  // miroir de notify_next_send, mais crée des WhatsappMessage au lieu de
  // Notification. Un joueur/match déjà généré n'est pas régénéré (cf.
  // computeNextMatchWhatsappTargets) tant que le match n'est pas modifié.
  if (action === 'generate_next_match') {
    try {
      const targets = await computeNextMatchWhatsappTargets()
      if (targets.length === 0) {
        return res.status(200).json({ ok: true, count: 0, message: 'Aucun joueur à générer : tous ont déjà leurs boutons WhatsApp pour ce cycle (ou aucun match planifié n\'a de date).' })
      }
      const template = await getWhatsappTemplate('next_match')
      let count = 0
      const touchedPmIds = new Set()
      for (const t of targets) {
        const phone = normalizePhoneForWa(t.user.phone)
        if (!phone) continue
        const vars = buildWhatsappVars(t.user, t.plannedMatch, t.opponent)
        const content = renderWhatsappTemplate(template, vars)
        await prisma.whatsappMessage.create({
          data: { userId: t.userId, type: 'next_match', phone, content, plannedMatchId: t.plannedMatch.id },
        })
        touchedPmIds.add(t.plannedMatch.id)
        count++
      }
      for (const pmId of touchedPmIds) {
        await prisma.plannedMatch.update({ where: { id: pmId }, data: { whatsappGeneratedAt: new Date() } }).catch(() => {})
      }
      return res.status(200).json({ ok: true, count, message: `${count} bouton(s) WhatsApp généré(s).` })
    } catch (err) {
      console.error('[admin/whatsapp generate_next_match]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Génère les boutons "rappel de score" — miroir de send_reminders_manual.
  if (action === 'generate_reminders') {
    try {
      const now = new Date()
      const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)
      const upcoming = await prisma.plannedMatch.findMany({
        where: { forfeited: false, notifiedAt: { not: null }, deadlineAt: { gte: now, lte: deadline48h } },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, phone: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, phone: true, category: true } },
        },
      })
      const template = await getWhatsappTemplate('reminder')
      let count = 0
      for (const pm of upcoming) {
        for (const { player, opponent } of [
          { player: pm.player1, opponent: pm.player2 },
          { player: pm.player2, opponent: pm.player1 },
        ]) {
          if (ADMIN_USERNAMES.includes(player.username.toLowerCase())) continue
          const already = await prisma.whatsappMessage.findFirst({
            where: { userId: player.id, plannedMatchId: pm.id, type: 'reminder', createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) } },
          })
          if (already) continue
          const phone = normalizePhoneForWa(player.phone)
          if (!phone) continue
          const vars = buildWhatsappVars(player, pm, opponent)
          const content = renderWhatsappTemplate(template, vars)
          await prisma.whatsappMessage.create({
            data: { userId: player.id, type: 'reminder', phone, content, plannedMatchId: pm.id },
          })
          count++
        }
      }
      return res.status(200).json({ ok: true, count, message: `${count} bouton(s) de rappel généré(s).` })
    } catch (err) {
      console.error('[admin/whatsapp generate_reminders]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Message libre (individuel ou groupe) depuis "Notifier un joueur" en mode
  // WhatsApp : un bouton généré par destinataire, message personnalisé.
  if (action === 'generate_custom') {
    const { userIds, message } = req.body || {}
    if (!Array.isArray(userIds) || userIds.length === 0) return res.status(400).json({ error: 'Au moins un joueur requis.' })
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message requis.' })
    try {
      let count = 0
      for (const rawId of userIds) {
        const uid = parseInt(rawId, 10)
        if (isNaN(uid)) continue
        const user = await prisma.user.findUnique({ where: { id: uid } })
        if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase())) continue
        const phone = normalizePhoneForWa(user.phone)
        if (!phone) continue

        const pm = await prisma.plannedMatch.findFirst({
          where: { forfeited: false, scheduledDate: { not: null }, OR: [{ player1Id: uid }, { player2Id: uid }] },
          orderBy: { scheduledDate: 'asc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, category: true } },
            player2: { select: { id: true, firstName: true, lastName: true, category: true } },
          },
        })
        const opponent = pm ? (pm.player1Id === uid ? pm.player2 : pm.player1) : null
        const vars = buildWhatsappVars(user, pm, opponent)
        const content = renderWhatsappTemplate(message, vars)

        await prisma.whatsappMessage.create({
          data: { userId: uid, type: 'custom', phone, content, plannedMatchId: pm?.id || null },
        })
        count++
      }
      return res.status(201).json({ ok: true, count, message: `${count} bouton(s) WhatsApp généré(s).` })
    } catch (err) {
      console.error('[admin/whatsapp generate_custom]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'mark_sent') {
    const { id } = req.body || {}
    const mid = parseInt(id, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'id invalide.' })
    try {
      await prisma.whatsappMessage.update({ where: { id: mid }, data: { sent: true, sentAt: new Date() } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/whatsapp mark_sent]', err)
      return res.status(500).json({ error: 'Erreur serveur ou message introuvable.' })
    }
  }

  if (action === 'delete') {
    const { id } = req.body || {}
    const mid = parseInt(id, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'id invalide.' })
    try {
      await prisma.whatsappMessage.delete({ where: { id: mid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[admin/whatsapp delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou message introuvable.' })
    }
  }

  if (action === 'delete_all') {
    try {
      const result = await prisma.whatsappMessage.deleteMany({})
      return res.status(200).json({ ok: true, count: result.count, message: `${result.count} message(s) supprimé(s).` })
    } catch (err) {
      console.error('[admin/whatsapp delete_all]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

// Variante WhatsApp de computeNextMatchTargets (voir plus bas dans ce fichier) :
// le "déjà généré" est tracé via l'existence d'un WhatsappMessage
// (type='next_match', plannedMatchId, userId) plutôt que Notification, pour
// permettre au canal WhatsApp et au canal site d'être générés indépendamment.
async function computeNextMatchWhatsappTargets() {
  const matches = await prisma.plannedMatch.findMany({
    where: { forfeited: false, scheduledDate: { not: null } },
    orderBy: { scheduledDate: 'asc' },
    include: {
      player1: { select: { id: true, firstName: true, lastName: true, username: true, phone: true, category: true } },
      player2: { select: { id: true, firstName: true, lastName: true, username: true, phone: true, category: true } },
    },
  })

  const nextByUser = new Map()
  for (const pm of matches) {
    if (!nextByUser.has(pm.player1Id)) nextByUser.set(pm.player1Id, pm)
    if (!nextByUser.has(pm.player2Id)) nextByUser.set(pm.player2Id, pm)
  }
  if (nextByUser.size === 0) return []

  const candidateMatchIds = [...new Set([...nextByUser.values()].map(pm => pm.id))]
  const alreadySent = await prisma.whatsappMessage.findMany({
    where: { type: 'next_match', plannedMatchId: { in: candidateMatchIds } },
    select: { userId: true, plannedMatchId: true },
  })
  const sentKeys = new Set(alreadySent.map(n => `${n.plannedMatchId}-${n.userId}`))

  const targets = []
  for (const [userId, pm] of nextByUser) {
    const user = pm.player1Id === userId ? pm.player1 : pm.player2
    if (ADMIN_USERNAMES.includes(user.username.toLowerCase())) continue
    if (sentKeys.has(`${pm.id}-${userId}`)) continue
    const isP1 = pm.player1Id === userId
    targets.push({ userId, user: isP1 ? pm.player1 : pm.player2, opponent: isP1 ? pm.player2 : pm.player1, plannedMatch: pm })
  }
  return targets
}

/* ============================================================
 * PHASE — état du tournoi (ex admin/phase.js) — GET public, POST admin
 * ============================================================ */
async function handlePhase(req, res) {
  if (req.method === 'GET') {
    try {
      const state = await prisma.tournamentState.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, currentPhase: 'PHASE0', currentRound: null },
      })
      return res.status(200).json({
        phase: state.currentPhase,
        round: state.currentRound,
        rankingSnapshot: state.rankingSnapshot ? true : false,
        siteSuspended: state.siteSuspended,
      })
    } catch (err) {
      console.error('[admin/phase GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  const payload = requireAdmin(req, res)
  if (!payload) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { phase, round } = req.body || {}

  const validPhases = ['PHASE0', 'PHASE1', 'PHASE2']
  if (!phase || !validPhases.includes(phase)) {
    return res.status(400).json({ error: 'Phase invalide. Valeurs : PHASE0, PHASE1, PHASE2.' })
  }

  if (phase === 'PHASE2') {
    const r = parseInt(round, 10)
    if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2 (entier ≥ 1).' })
  }

  try {
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {
        currentPhase: phase,
        currentRound: phase === 'PHASE2' ? parseInt(round, 10) : null,
      },
      create: {
        id: 1,
        currentPhase: phase,
        currentRound: phase === 'PHASE2' ? parseInt(round, 10) : null,
      },
    })

    // Push téléphone à tous les joueurs actifs pour annoncer le passage de phase
    const phaseLabels = { PHASE0: 'Hors saison', PHASE1: 'Phase de poules', PHASE2: 'Phase finale' }
    const phaseLabel  = phaseLabels[phase] || phase
    const pushBody = phase === 'PHASE2'
      ? `La Phase finale commence — ronde ${parseInt(round, 10)} ! Consultez le classement.`
      : `Le tournoi passe en ${phaseLabel}. Consultez les nouveautés sur CDR.`
    ;(async () => {
      try {
        const players = await prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, NOT: { username: { in: ADMIN_USERNAMES } } },
          select: { id: true },
        })
        await Promise.allSettled(
          players.map(u => sendPushToUser(prisma, u.id, {
            title: `🏆 Nouveau chapitre : ${phaseLabel}`,
            body: pushBody,
            tab: 'accueil',
          }))
        )
      } catch {}
    })()

    return res.status(200).json({ ok: true, phase: state.currentPhase, round: state.currentRound })
  } catch (err) {
    console.error('[admin/phase POST]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * POULES — gestion des poules et groupes Phase 2 (ex admin/poules.js)
 * ============================================================ */
async function handlePoules(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [poules, groups, allUsers] = await Promise.all([
        prisma.poule.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.phase2Group.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
              },
            },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true, isBot: true },
          orderBy: { lastName: 'asc' },
        }),
      ])

      const inPoule = new Set(poules.flatMap(p => p.members.map(m => m.userId)))
      const unassigned = allUsers.filter(u => !inPoule.has(u.id))

      const inGroup = new Set(groups.flatMap(g => g.members.map(m => m.userId)))
      const unassignedGroups = allUsers.filter(u => !inGroup.has(u.id))

      return res.status(200).json({ poules, groups, unassigned, unassignedGroups, allUsers })
    } catch (err) {
      console.error('[admin/poules GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'create_poule') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const poule = await prisma.poule.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, poule })
    } catch (err) {
      console.error('[create_poule]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_poule') {
    const { pouleId, name } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid) || !name?.trim()) return res.status(400).json({ error: 'pouleId et name requis.' })
    try {
      const poule = await prisma.poule.update({ where: { id: pid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, poule })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_poule') {
    const { pouleId } = req.body
    const pid = parseInt(pouleId, 10)
    if (isNaN(pid)) return res.status(400).json({ error: 'pouleId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'POULE', [pid])
        await tx.poule.delete({ where: { id: pid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[delete_poule]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'pouleId et userId invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })
    if (!user.active)
      return res.status(403).json({ error: 'Ce joueur est inactif et ne peut pas être ajouté à une poule.' })

    try {
      await prisma.pouleMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.pouleMember.create({ data: { pouleId: pid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      console.error('[add_member]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_member') {
    const { pouleId, userId } = req.body
    const pid = parseInt(pouleId, 10), uid = parseInt(userId, 10)
    if (isNaN(pid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.pouleMember.deleteMany({ where: { pouleId: pid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'fill_random') {
    const { pouleId, count } = req.body
    const pid = parseInt(pouleId, 10), cnt = parseInt(count, 10)
    if (isNaN(pid) || isNaN(cnt) || cnt < 1) return res.status(400).json({ error: 'Paramètres invalides.' })

    try {
      const allAssigned = await prisma.pouleMember.findMany({ select: { userId: true } })
      const assignedIds = new Set(allAssigned.map(m => m.userId))
      const eligible = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
        select: { id: true },
      })
      const pool = eligible.filter(u => !assignedIds.has(u.id))

      if (pool.length === 0) return res.status(400).json({ error: 'Aucun joueur disponible.' })

      const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, cnt)
      await prisma.pouleMember.createMany({
        data: shuffled.map(u => ({ pouleId: pid, userId: u.id })),
        skipDuplicates: true,
      })
      return res.status(200).json({ ok: true, added: shuffled.length })
    } catch (err) {
      console.error('[fill_random]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'create_group') {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' })
    try {
      const group = await prisma.phase2Group.create({ data: { name: name.trim() } })
      return res.status(201).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Crée "Renards Choquants" et "Renards Choqués" et y répartit les joueurs
  // selon le classement courant : première moitié (les plus forts) → Choquants,
  // seconde moitié → Choqués.
  if (action === 'init_default_groups') {
    try {
      // Récupérer tous les joueurs actifs avec leurs matchs publiés
      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, createdAt: true,
          matches: { where: { published: true }, include: { sets: { orderBy: { setNumber: 'asc' } } } },
        },
      })

      // Classer selon le même critère que le classement affiché
      const ranked = sortPlayers(users.map(u => ({ id: u.id, createdAt: u.createdAt, ...computeStats(u.matches) })))

      const half = Math.ceil(ranked.length / 2)
      const topHalf    = ranked.slice(0, half)   // joueurs les plus forts
      const bottomHalf = ranked.slice(half)       // joueurs les moins forts

      await prisma.$transaction(async tx => {
        const g1 = await tx.phase2Group.create({ data: { name: 'Renards Choquants' } })
        const g2 = await tx.phase2Group.create({ data: { name: 'Renards Choqués' } })
        if (topHalf.length > 0) {
          await tx.phase2GroupMember.createMany({ data: topHalf.map(p => ({ groupId: g1.id, userId: p.id })) })
        }
        if (bottomHalf.length > 0) {
          await tx.phase2GroupMember.createMany({ data: bottomHalf.map(p => ({ groupId: g2.id, userId: p.id })) })
        }
      })

      return res.status(201).json({ ok: true })
    } catch (err) {
      console.error('[admin/poules init_default_groups]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'rename_group') {
    const { groupId, name } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid) || !name?.trim()) return res.status(400).json({ error: 'groupId et name requis.' })
    try {
      const group = await prisma.phase2Group.update({ where: { id: gid }, data: { name: name.trim() } })
      return res.status(200).json({ ok: true, group })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_group') {
    const { groupId } = req.body
    const gid = parseInt(groupId, 10)
    if (isNaN(gid)) return res.status(400).json({ error: 'groupId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'PHASE2_GROUP', [gid])
        await tx.phase2Group.delete({ where: { id: gid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[delete_group]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })

    const user = await prisma.user.findUnique({ where: { id: uid } })
    if (!user || ADMIN_USERNAMES.includes(user.username.toLowerCase()))
      return res.status(403).json({ error: 'Joueur invalide.' })
    if (!user.active)
      return res.status(403).json({ error: 'Ce joueur est inactif et ne peut pas être ajouté à un groupe.' })

    try {
      await prisma.phase2GroupMember.deleteMany({ where: { userId: uid } })
      const member = await prisma.phase2GroupMember.create({ data: { groupId: gid, userId: uid } })
      return res.status(201).json({ ok: true, member })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'remove_group_member') {
    const { groupId, userId } = req.body
    const gid = parseInt(groupId, 10), uid = parseInt(userId, 10)
    if (isNaN(gid) || isNaN(uid)) return res.status(400).json({ error: 'Paramètres invalides.' })
    try {
      await prisma.phase2GroupMember.deleteMany({ where: { groupId: gid, userId: uid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * ACTION — gestion des utilisateurs + actions globales (ex admin/action.js)
 * ============================================================ */
async function handleAction(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      if (req.query.refused === '1') {
        const refused = await prisma.refusedRegistration.findMany({
          orderBy: { refusedAt: 'desc' },
        })
        return res.status(200).json({ refused })
      }

      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, firstName: true, lastName: true,
          phone: true, category: true, role: true,
          accepted: true, banned: true, active: true, createdAt: true, isBot: true,
        },
      })
      return res.status(200).json({ users })
    } catch (err) {
      console.error('[admin/action GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action, userId, data } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action requis.' })

  const globalActions = [
    'suspend_site', 'unsuspend_site', 'force_logout_all',
    'reset_all_matches', 'reset_all_notifications', 'deactivate_all_players',
    'scrape_myffbad', 'apply_myffbad_changes', 'reset_faq_stats',
    'toggle_auto_reminders', 'send_reminders_manual',
    'update_hidden_tabs', 'update_malus_config',
    'generate_season_pdf',
  ]

  if (globalActions.includes(action)) {
    try {
      switch (action) {
        case 'suspend_site': {
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { siteSuspended: true },
            create: { id: 1, currentPhase: 'PHASE0', siteSuspended: true },
          })
          await prisma.user.updateMany({
            where: { role: 'USER', banned: false },
            data: { forceLogout: true },
          })
          return res.status(200).json({ ok: true, message: 'Site suspendu. Tous les joueurs ont été déconnectés.' })
        }

        case 'unsuspend_site': {
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { siteSuspended: false },
            create: { id: 1, currentPhase: 'PHASE0', siteSuspended: false },
          })
          return res.status(200).json({ ok: true, message: 'Site réactivé.' })
        }

        case 'force_logout_all': {
          await prisma.user.updateMany({
            where: { role: 'USER' },
            data: { forceLogout: true },
          })
          return res.status(200).json({ ok: true, message: 'Déconnexion forcée pour tous les joueurs.' })
        }

        case 'reset_all_matches': {
          await prisma.$transaction(async (tx) => {
            await logDeletion(tx, 'RESET_TOURNOI')
            await tx.matchSet.deleteMany({})
            await tx.match.deleteMany({})
            await tx.pouleMember.deleteMany({})
            await tx.poule.deleteMany({})
            await tx.phase2GroupMember.deleteMany({})
            await tx.phase2Group.deleteMany({})
            await tx.specialMatch.deleteMany({})
            await tx.plannedMatch.deleteMany({})
            await tx.tournamentState.upsert({
              where: { id: 1 },
              update: { rankingSnapshot: null, currentPhase: 'PHASE0', currentRound: null },
              create: { id: 1, currentPhase: 'PHASE0' },
            })
          })
          return res.status(200).json({ ok: true, message: 'Tous les matchs, scores, poules et groupes ont été supprimés. Tournoi réinitialisé.' })
        }

        case 'reset_all_notifications': {
          await prisma.$transaction(async (tx) => {
            const all = await tx.notification.findMany({ select: { id: true } })
            await logDeletion(tx, 'NOTIFICATION', all.map(n => n.id), `Suppression de toutes les notifications (${all.length})`)
            await tx.notification.deleteMany({})
          })
          return res.status(200).json({ ok: true, message: 'Toutes les notifications ont été supprimées.' })
        }

        case 'deactivate_all_players': {
          await prisma.user.updateMany({
            where: { role: 'USER', username: { notIn: ADMIN_USERNAMES } },
            data: { active: false },
          })
          return res.status(200).json({ ok: true, message: 'Tous les joueurs ont été mis en inactif.' })
        }

        // Purge complète des données de "visibilité" de la FAQ : votes
        // (like/dislike), historique de consultation (FaqView) et remise à
        // zéro des compteurs dénormalisés sur FaqTopic. Ne touche pas au
        // contenu de la FAQ (sujets/questions/réponses).
        case 'reset_faq_stats': {
          await prisma.$transaction(async (tx) => {
            await logDeletion(tx, 'FAQ_STATS')
            await tx.faqVote.deleteMany({})
            await tx.faqView.deleteMany({})
            await tx.faqTopic.updateMany({
              data: { viewCount: 0, usefulCount: 0, notUsefulCount: 0 },
            })
          })
          return res.status(200).json({
            ok: true,
            message: 'Les votes, vues et historique de consultation de la FAQ ont été réinitialisés pour tous les sujets.',
          })
        }

        case 'scrape_myffbad': {
          const { scraped, logs } = await scrapeMyffbadClub()

          logs.push({ ok: true, message: `── Total récupéré sur MYFFBAD : ${scraped.length} joueur(s). ──` })

          const users = await prisma.user.findMany({
            where: { username: { notIn: ADMIN_USERNAMES }, isBot: false },
            select: { id: true, firstName: true, lastName: true, category: true, username: true },
          })

          const normedScraped = scraped.map(s => ({ ...s, norm: normName(s.fullName) }))

          const results = []
          for (const u of users) {
            const displayName = `${u.firstName} ${u.lastName}`
            const key1 = normName(u.firstName + u.lastName)
            const key2 = normName(u.lastName + u.firstName)
            const match = normedScraped.find(s => s.norm === key1 || s.norm === key2)

            if (!match) {
              results.push({
                userId: u.id, name: displayName, found: false, changed: false,
                message: `${displayName} : non trouvé sur MYFFBAD.`,
              })
              continue
            }

            const m = match.simpleToken.match(/^([A-Z]+)/)
            const letter = m ? m[1] : null

            if (!letter || !VALID_CATEGORIES.includes(letter)) {
              results.push({
                userId: u.id, name: displayName, found: true, changed: false,
                message: `${displayName} : classement simple non disponible (« ${match.simpleToken || '—'} »), catégorie inchangée.`,
              })
              continue
            }

            if (letter === u.category) {
              results.push({
                userId: u.id, name: displayName, found: true, changed: false,
                message: `${displayName} : classement inchangé (${letter}).`,
              })
            } else {
              results.push({
                userId: u.id, name: displayName, found: true, changed: true,
                from: u.category, to: letter,
                message: `${displayName} : classement ${u.category} → ${letter} (en attente de confirmation).`,
              })
            }
          }

          const changedCount = results.filter(r => r.changed).length
          const notFoundCount = results.filter(r => !r.found).length

          return res.status(200).json({
            ok: true,
            logs,
            results,
            totalScraped: scraped.length,
            changedCount,
            notFoundCount,
            message: `Comparaison MYFFBAD terminée : ${changedCount} changement(s) proposé(s), ${notFoundCount} joueur(s) non trouvé(s).`,
          })
        }

        case 'apply_myffbad_changes': {
          const { changes } = req.body || {}
          if (!Array.isArray(changes) || changes.length === 0) {
            return res.status(400).json({ error: 'Aucune modification à appliquer.' })
          }

          const applied = []
          for (const c of changes) {
            const uid = parseInt(c?.userId, 10)
            const category = c?.category
            if (isNaN(uid) || !VALID_CATEGORIES.includes(category)) continue

            const u = await prisma.user.findUnique({ where: { id: uid } })
            if (!u || ADMIN_USERNAMES.includes(u.username.toLowerCase())) continue

            await prisma.user.update({ where: { id: uid }, data: { category } })
            applied.push({ userId: uid, name: `${u.firstName} ${u.lastName}`, category })
          }

          return res.status(200).json({
            ok: true,
            appliedCount: applied.length,
            applied,
            message: `${applied.length} classement(s) mis à jour.`,
          })
        }

        case 'toggle_auto_reminders': {
          const state = await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: {},
            create: { id: 1, currentPhase: 'PHASE0' },
          })
          const next = !state.autoRemindersEnabled
          await prisma.tournamentState.update({ where: { id: 1 }, data: { autoRemindersEnabled: next } })
          return res.status(200).json({
            ok: true,
            autoRemindersEnabled: next,
            message: next ? 'Rappels automatiques activés.' : 'Rappels automatiques désactivés.',
          })
        }

        case 'send_reminders_manual': {
          // Même logique que le cron-deadline-reminders, déclenchée manuellement
          const now = new Date()
          const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)
          const upcoming = await prisma.plannedMatch.findMany({
            where: {
              forfeited: false,
              notifiedAt: { not: null }, // déjà notifié du match
              deadlineAt: { gte: now, lte: deadline48h },
            },
            include: {
              player1: { select: { id: true, firstName: true, lastName: true, username: true } },
              player2: { select: { id: true, firstName: true, lastName: true, username: true } },
            },
          })
          let sent = 0
          for (const pm of upcoming) {
            for (const { player, opponent } of [
              { player: pm.player1, opponent: pm.player2 },
              { player: pm.player2, opponent: pm.player1 },
            ]) {
              if (ADMIN_USERNAMES.includes(player.username.toLowerCase())) continue
              // BUG FIX : utiliser 'deadline_reminder' et non 'next_match' —
              // le mauvais type causait des doublons avec le cron ET empêchait
              // la vraie notification "prochain match" d'être envoyée.
              const alreadySent = await prisma.notification.findFirst({
                where: {
                  userId: player.id,
                  plannedMatchId: pm.id,
                  type: 'deadline_reminder',
                  createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
                },
              })
              if (alreadySent) continue
              await prisma.notification.create({
                data: {
                  userId: player.id,
                  type: 'deadline_reminder',
                  title: '⏰ Rappel : score à saisir',
                  message: `Votre match contre ${opponent.firstName} ${opponent.lastName} approche de sa deadline. Pensez à saisir votre score !`,
                  opponentName: `${opponent.firstName} ${opponent.lastName}`,
                  plannedMatchId: pm.id,
                },
              })
              sent++
            }
          }
          return res.status(200).json({
            ok: true,
            sent,
            message: `${sent} rappel(s) envoyé(s) manuellement.`,
          })
        }

        case 'update_hidden_tabs': {
          const { hiddenTabs, tabOrder } = req.body || {}
          if (!Array.isArray(hiddenTabs)) return res.status(400).json({ error: 'hiddenTabs (array) requis.' })
          const data = { hiddenTabs: JSON.stringify(hiddenTabs) }
          if (Array.isArray(tabOrder)) data.tabOrder = JSON.stringify(tabOrder)
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: data,
            create: { id: 1, currentPhase: 'PHASE0', ...data },
          })
          return res.status(200).json({ ok: true, hiddenTabs, tabOrder: tabOrder || [], message: 'Onglets mis à jour.' })
        }

        case 'update_malus_config': {
          const { malusList: newList } = req.body || {}
          if (!Array.isArray(newList)) return res.status(400).json({ error: 'malusList (array) requis.' })
          // Accepte le nouveau format [{text, enabled, maxConcurrent}] ou l'ancien [strings]
          const normalized = newList.map(item => {
            if (typeof item === 'string') return { text: item.trim(), enabled: true, maxConcurrent: null }
            const mc = parseInt(item.maxConcurrent, 10)
            return {
              text: String(item.text || '').trim(),
              enabled: item.enabled !== false,
              maxConcurrent: (!isNaN(mc) && mc > 0) ? mc : null,
            }
          }).filter(m => m.text.length > 0)
          if (normalized.length === 0) return res.status(400).json({ error: 'La liste de malus ne peut pas être vide.' })
          const cleaned = normalized // objets {text, enabled, maxConcurrent}
          const activeTexts = cleaned.filter(m => m.enabled).map(m => m.text)
          if (activeTexts.length === 0) return res.status(400).json({ error: 'Au moins un malus doit être actif.' })

          // Trouver les malus qui ne sont plus actifs (supprimés ou désactivés) et réassigner
          const currentList = await loadMalusList() // strings actifs actuels
          const removed = currentList.filter(m => !activeTexts.includes(m))

          let reassigned = 0
          if (removed.length > 0) {
            const affectedMatches = await prisma.plannedMatch.findMany({
              where: { malus: { in: removed } },
              include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
            })
            for (const pm of affectedMatches) {
              const newMalus = activeTexts[Math.floor(Math.random() * activeTexts.length)]
              await prisma.plannedMatch.update({ where: { id: pm.id }, data: { malus: newMalus } })
              await prisma.schedulingLog.create({
                data: {
                  phase: pm.phase,
                  type: 'avertissement',
                  message: `Malus modifié automatiquement pour le match #${pm.id} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) : l'ancien malus est désactivé ou supprimé. Nouveau malus attribué : « ${newMalus} ».`,
                },
              })
              reassigned++
            }
          }

          // Appliquer les limites de concurrence (maxConcurrent) :
          // pour chaque malus ayant une limite, si trop de matchs actifs l'utilisent,
          // réassigner le surplus vers d'autres malus actifs.
          const concurrencyResult = await enforceMalusConcurrency(cleaned)
          reassigned += concurrencyResult.reassigned
          if (concurrencyResult.logMessages.length > 0) {
            await prisma.schedulingLog.createMany({ data: concurrencyResult.logMessages })
          }

          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { malusConfig: JSON.stringify(cleaned) },
            create: { id: 1, currentPhase: 'PHASE0', malusConfig: JSON.stringify(cleaned) },
          })

          return res.status(200).json({
            ok: true,
            malusList: cleaned, // objets {text, enabled, maxConcurrent}
            reassigned,
            message: `Liste de malus mise à jour (${cleaned.length} entrée(s))${reassigned > 0 ? `. ${reassigned} match(s) planifié(s) réassigné(s) — voir la console de planification.` : '.'}`,
          })
        }

        case 'generate_season_pdf': {
          const [state, poules, phase2Groups, medals, allUsers] = await Promise.all([
            prisma.tournamentState.findUnique({ where: { id: 1 } }),
            prisma.poule.findMany({ orderBy: { createdAt: 'asc' }, include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true, createdAt: true } } } } } }),
            prisma.phase2Group.findMany({ orderBy: { createdAt: 'asc' }, include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true, createdAt: true } } } } } }),
            prisma.medal.findMany({ orderBy: [{ seasonYear: 'desc' }, { createdAt: 'desc' }] }),
            prisma.user.findMany({
              where: { accepted: true, banned: false, active: true, isBot: false, username: { notIn: ADMIN_USERNAMES } },
              select: { id: true, firstName: true, lastName: true, username: true, category: true, createdAt: true, matches: { where: { published: true }, include: { sets: { orderBy: { setNumber: 'asc' } } } } },
              orderBy: { createdAt: 'asc' },
            }),
          ])
          const playersWithStats = allUsers.map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username, category: u.category, createdAt: u.createdAt, ...computeStats(u.matches) }))
          const rankedPlayers = sortPlayers(playersWithStats)
          const totalMatchesRaw = playersWithStats.reduce((s, p) => s + p.played, 0)
          const totalSetsRaw = allUsers.reduce((s, u) => s + u.matches.reduce((ss, m) => ss + (m.sets?.length || 0), 0), 0)
          const poulesEnriched = poules.map(p => { const ids = new Set(p.members.map(m => m.userId)); return { id: p.id, name: p.name, members: rankedPlayers.filter(pl => ids.has(pl.id)) } })
          const groupsEnriched = phase2Groups.map(g => { const ids = new Set(g.members.map(m => m.userId)); return { id: g.id, name: g.name, members: rankedPlayers.filter(pl => ids.has(pl.id)) } })
          const latestMatch = await prisma.match.findFirst({ where: { published: true }, orderBy: { matchDate: 'desc' }, select: { matchDate: true } })
          const seasonYear = latestMatch?.matchDate ? new Date(latestMatch.matchDate).getFullYear() : new Date().getFullYear()
          return res.status(200).json({
            ok: true,
            pdfData: {
              seasonYear,
              players: rankedPlayers,
              poules: poulesEnriched,
              phase2Groups: groupsEnriched,
              medals,
              stats: {
                totalMatches: Math.round(totalMatchesRaw / 2),
                totalSets: Math.round(totalSetsRaw / 2),
                playerCount: rankedPlayers.length,
                pouleCount: poules.length,
                groupCount: phase2Groups.length,
                medalCount: medals.length,
              },
            },
          })
        }
      }
    } catch (err) {
      console.error('[admin/action global]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // Liste des versions restaurables (non expirées, non déjà restaurées), pour
  // l'onglet "Actions et autres". Pas de payload complet renvoyé (potentiellement
  // volumineux) : uniquement les métadonnées d'affichage.
  if (action === 'list_versions') {
    try {
      const versions = await prisma.dataVersion.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, entityType: true, createdAt: true, expiresAt: true, restoredAt: true },
      })
      return res.status(200).json({ ok: true, versions })
    } catch (err) {
      console.error('[list_versions]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'restore_version') {
    const { versionId } = req.body
    const vid = parseInt(versionId, 10)
    if (isNaN(vid)) return res.status(400).json({ error: 'versionId invalide.' })
    try {
      const result = await prisma.$transaction(
 	 async (tx) => restoreVersion(tx, vid),
  	{ timeout: 60000, maxWait: 10000 } // 60s de budget pour la transaction, 10s pour l'obtenir
	)
      return res.status(200).json({ ok: true, ...result })
    } catch (err) {
      console.error('[restore_version]', err)
      return res.status(400).json({ error: err.message || 'Erreur lors de la restauration.' })
    }
  }

  if (!userId) return res.status(400).json({ error: 'userId requis pour cette action.' })

  const id = parseInt(userId, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'userId invalide.' })

  try {
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' })

    if (ADMIN_USERNAMES.includes(user.username.toLowerCase())) {
      return res.status(403).json({ error: 'Ce compte ne peut pas être modifié.' })
    }

    switch (action) {
      case 'accept': {
        await prisma.user.update({ where: { id }, data: { accepted: true, banned: false } })
        return res.status(200).json({ ok: true, message: 'Utilisateur accepté.' })
      }

      case 'refuse': {
        await prisma.$transaction(async (tx) => {
          await tx.refusedRegistration.create({
            data: {
              firstName: user.firstName,
              lastName:  user.lastName,
              phone:     user.phone,
            },
          })
          await logDeletion(tx, 'USER', [id], `Refus d'inscription : ${user.firstName} ${user.lastName}`)
          await tx.user.delete({ where: { id } })
        })
        return res.status(200).json({ ok: true, message: 'Demande refusée, compte supprimé.' })
      }

      case 'ban': {
        await prisma.user.update({ where: { id }, data: { banned: true, accepted: false, forceLogout: true } })
        return res.status(200).json({ ok: true, message: 'Utilisateur banni et déconnecté.' })
      }

      case 'unban': {
        await prisma.user.update({ where: { id }, data: { banned: false, accepted: true, forceLogout: false } })
        return res.status(200).json({ ok: true, message: 'Bannissement levé.' })
      }

      case 'delete_banned': {
        if (!user.banned) return res.status(400).json({ error: 'Cet utilisateur n\'est pas banni.' })
        await prisma.$transaction(async (tx) => {
          await logDeletion(tx, 'USER', [id])
          await tx.user.delete({ where: { id } })
        })
        return res.status(200).json({ ok: true, message: 'Utilisateur banni supprimé définitivement.' })
      }

      case 'activate': {
        await prisma.user.update({ where: { id }, data: { active: true } })
        return res.status(200).json({ ok: true, message: 'Utilisateur activé.' })
      }

      case 'deactivate': {
        await prisma.user.update({ where: { id }, data: { active: false } })
        return res.status(200).json({ ok: true, message: 'Utilisateur désactivé.' })
      }

      // ── reset_password : remplace le mot de passe par un hash déjà calculé
      // par le joueur (l'admin n'a jamais connaissance du mot de passe en clair) ──
      case 'reset_password': {
        const { newPasswordHash } = req.body || {}
        if (!newPasswordHash || typeof newPasswordHash !== 'string')
          return res.status(400).json({ error: 'newPasswordHash requis.' })

        const hash = newPasswordHash.trim()
        if (hash.length > 200 || !ARGON2_HASH_REGEX.test(hash)) {
          return res.status(400).json({
            error: 'Format de hash invalide. Le hash doit être un hash Argon2 encodé complet (commence par $argon2id$, $argon2i$ ou $argon2d$).',
          })
        }

        await prisma.user.update({
          where: { id },
          data: { passwordHash: hash, forceLogout: true },
        })
        return res.status(200).json({
          ok: true,
          message: 'Mot de passe remplacé. Le joueur a été déconnecté de toutes ses sessions actives.',
        })
      }

      case 'update': {
        if (!data) return res.status(400).json({ error: 'Données de mise à jour manquantes.' })
        const { firstName, lastName, username, phone, category } = data
        if (category && !VALID_CATEGORIES.includes(category))
          return res.status(400).json({ error: 'Catégorie invalide.' })
        if (username && username !== user.username) {
          if (ADMIN_USERNAMES.includes(username.toLowerCase()))
            return res.status(400).json({ error: 'Ce pseudo est réservé.' })
          // BUG FIX : vérification insensible à la casse, cohérente avec le login.
          const existing = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })
          if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' })
        }
        const updateData = {}
        if (firstName) updateData.firstName = capName(firstName)
        if (lastName)  updateData.lastName  = capName(lastName)
        if (username)  updateData.username  = username
        if (phone)     updateData.phone     = phone
        if (category)  updateData.category  = category
        const updated = await prisma.user.update({
          where: { id }, data: updateData,
          select: {
            id: true, username: true, firstName: true, lastName: true,
            phone: true, category: true, role: true,
            accepted: true, banned: true, active: true, createdAt: true,
          },
        })
        // BUG FIX : Medal.username est une chaîne brute — synchro au renommage.
        if (username && username !== user.username) {
          await prisma.medal.updateMany({ where: { username: { equals: user.username, mode: 'insensitive' } }, data: { username } }).catch(() => {})
        }
        return res.status(200).json({ ok: true, user: updated })
      }

      default:
        return res.status(400).json({ error: `Action inconnue : ${action}` })
    }
  } catch (err) {
    console.error('[admin/action]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}

/* ============================================================
 * MATCH — gestion des matchs, planifications, photos (ex admin/match.js)
 * ============================================================ */

// Normalise un nom (prénom+nom) pour comparer sans tenir compte des
// accents / casses / espaces superflus.
// BUG FIX : renommée normPersonName — deux function normName(){} dans le même scope
// font que seule la DERNIÈRE survit à l'exécution (hoisting JS), ce qui cassait
// silencieusement la comparaison des noms MYFFBAD.
function normPersonName(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Renvoie true si le match A et le match B sont des miroirs (même
// confrontation vue des deux côtés). Critères : même date (au jour près),
// même phase, même round, et l'userId de l'un correspond à un joueur dont le
// nom matche l'opponent de l'autre (et inversement).
function areMirrorMatches(a, b, userById) {
  if (a.id === b.id) return false
  // Même date (comparaison au jour près)
  const da = a.matchDate ? new Date(a.matchDate).toISOString().slice(0, 10) : null
  const db = b.matchDate ? new Date(b.matchDate).toISOString().slice(0, 10) : null
  if (da !== db) return false
  // Même phase et round
  if ((a.phase || null) !== (b.phase || null)) return false
  if ((a.roundNumber ?? null) !== (b.roundNumber ?? null)) return false
  // A.userId ↔ B.opponent et B.userId ↔ A.opponent
  const ua = userById.get(a.userId)
  const ub = userById.get(b.userId)
  if (!ua || !ub) return false
  const aUserMatchBOpp = normPersonName(ua.firstName + ' ' + ua.lastName) === normPersonName(b.opponentFirstName + ' ' + b.opponentLastName)
  const bUserMatchAOpp = normPersonName(ub.firstName + ' ' + ub.lastName) === normPersonName(a.opponentFirstName + ' ' + a.opponentLastName)
  return aUserMatchBOpp && bUserMatchAOpp
}

// Détermine si le joueur du match a gagné (plus de sets gagnants que l'adversaire).
function didPlayerWin(m) {
  if (!m.sets || m.sets.length === 0) return null
  const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
  const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
  if (pw === ow) return null // ex aequo / pas de sets décisifs
  return pw > ow
}

// Dédoublonne la liste des matchs en attente : pour chaque paire de miroirs,
// on ne garde QUE le match dont le joueur a gagné (premier joueur gagnant).
// Les matchs sans miroir (adversaire non inscrit) sont conservés tels quels.
// On attache aussi mirrorMatchId au match conservé pour pouvoir publier les
// deux en même temps.
function dedupePendingMatches(pending) {
  if (!pending || pending.length === 0) return []
  // Index des users pour résoudre userId → firstName/lastName
  const userById = new Map()
  for (const m of pending) {
    if (m.user && !userById.has(m.userId)) {
      userById.set(m.userId, { firstName: m.user.firstName, lastName: m.user.lastName })
    }
  }
  const used = new Set()
  const result = []
  for (const m of pending) {
    if (used.has(m.id)) continue
    // Chercher un miroir non encore utilisé
    const mirror = pending.find(o => !used.has(o.id) && o.id !== m.id && areMirrorMatches(m, o, userById))
    if (!mirror) {
      // Pas de miroir : on garde ce match tel quel
      result.push(m)
      used.add(m.id)
    } else {
      // Miroir trouvé : on garde celui dont le joueur a gagné. Si aucun des
      // deux n'a gagné (ex aequo), on garde le premier (m) par stabilité.
      const mWon = didPlayerWin(m)
      const mirrorWon = didPlayerWin(mirror)
      let keeper, other
      if (mWon === true) { keeper = m; other = mirror }
      else if (mirrorWon === true) { keeper = mirror; other = m }
      else { keeper = m; other = mirror }
      // Attacher l'ID du miroir pour publication simultanée
      keeper = { ...keeper, mirrorMatchId: other.id }
      result.push(keeper)
      used.add(m.id)
      used.add(mirror.id)
    }
  }
  return result
}

// Récupère l'ID du match miroir d'un match donné (pour publication simultanée).
// Recherche par confrontations (date, phase, round, noms croisés).
async function findMirrorMatchId(match) {
  if (!match) return null
  const candidates = await prisma.match.findMany({
    where: {
      id: { not: match.id },
      // Même date (au jour près) — Prisma ne supporte pas directement la
      // comparaison de date tronquée, on filtre ensuite en JS.
      phase: match.phase || null,
      roundNumber: match.roundNumber ?? null,
    },
    include: { sets: true, user: { select: { firstName: true, lastName: true } } },
  })
  const dMatch = match.matchDate ? new Date(match.matchDate).toISOString().slice(0, 10) : null
  const userById = new Map()
  userById.set(match.userId, { firstName: match.user?.firstName, lastName: match.user?.lastName })
  for (const c of candidates) {
    if (c.user) userById.set(c.userId, { firstName: c.user.firstName, lastName: c.user.lastName })
  }
  for (const c of candidates) {
    const dc = c.matchDate ? new Date(c.matchDate).toISOString().slice(0, 10) : null
    if (dc !== dMatch) continue
    if (areMirrorMatches({ ...match, user: match.user || userById.get(match.userId) }, c, userById)) {
      return c.id
    }
  }
  return null
}

async function handleMatch(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [pending, published, activeUsers, openSpecials, planned] = await Promise.all([
        prisma.match.findMany({
          where: { published: false },
          orderBy: { createdAt: 'desc' },
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            photos: { orderBy: { createdAt: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.match.findMany({
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          take: 200,
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            photos: { orderBy: { createdAt: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true, isBot: true },
          orderBy: { lastName: 'asc' },
        }),
        prisma.specialMatch.findMany({
          where: { resolved: false },
          orderBy: { createdAt: 'desc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.plannedMatch.findMany({
          orderBy: { scheduledDate: 'asc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true, phone: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true, phone: true } },
          },
        }),
      ])
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      // ── Dédoublonnage des matchs en attente (pending) ──
      // Les matchs entre deux joueurs inscrits créent un match « miroir » (un par
      // joueur). On ne veut présenter à l'admin qu'un seul représentant par
      // confrontation : celui dont le joueur a GAGNÉ (premier joueur gagnant).
      // On regroupe les matchs miroir par (matchDate, phase, roundNumber) et par
      // paire de joueurs (userId de l'un ↔ opponent de l'autre).
      const dedupedPending = dedupePendingMatches(pending)
      // malusListFull : objets {text, enabled, maxConcurrent} pour l'UI admin
      // malusList : strings actifs pour la planification (rétrocompatibilité)
      let malusListFull = []
      if (state?.malusConfig) {
        try {
          const cfg = JSON.parse(state.malusConfig)
          if (Array.isArray(cfg) && cfg.length > 0) {
            if (typeof cfg[0] === 'object' && 'text' in cfg[0]) {
              malusListFull = cfg.map(m => ({ text: m.text, enabled: m.enabled !== false, maxConcurrent: m.maxConcurrent || null }))
            } else {
              malusListFull = cfg.map(t => ({ text: t, enabled: true, maxConcurrent: null }))
            }
          }
        } catch {}
      }
      if (malusListFull.length === 0) malusListFull = DEFAULT_MALUS_LIST.map(t => ({ text: t, enabled: true, maxConcurrent: null }))
      const dynamicMalusList = malusListFull.filter(m => m.enabled !== false).map(m => m.text)
      return res.status(200).json({
        pending: dedupedPending, published, activeUsers, openSpecials, planned,
        malusList: malusListFull,
        defaultMalusList: DEFAULT_MALUS_LIST,
        autoRemindersEnabled: state?.autoRemindersEnabled ?? true,
        hiddenTabs: JSON.parse(state?.hiddenTabs || '[]'),
        tabOrder: JSON.parse(state?.tabOrder || '[]'),
      })
    } catch (err) {
      console.error('[admin/match GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'publish') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      // Récupérer le match pour trouver son miroir
      const match = await prisma.match.findUnique({
        where: { id: mid },
        include: { sets: true, user: { select: { firstName: true, lastName: true } } },
      })
      if (!match) return res.status(404).json({ error: 'Match introuvable.' })

      // Publier le match principal
      await prisma.match.update({ where: { id: mid }, data: { published: true } })

      // Trouver et publier le match miroir (l'autre perspective du même match)
      const mirrorId = await findMirrorMatchId(match)
      if (mirrorId) {
        await prisma.match.update({ where: { id: mirrorId }, data: { published: true } })
      }
      return res.status(200).json({ ok: true, mirrorPublished: !!mirrorId })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'publish_all') {
    try {
      const { count } = await prisma.match.updateMany({ where: { published: false }, data: { published: true } })
      return res.status(200).json({ ok: true, count })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'edit') {
    const { matchId, matchDate, opponentFirstName, opponentLastName, note, sets } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!sets || !Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    { const setsErr = validateSetScores(sets); if (setsErr) return res.status(400).json({ error: setsErr }) }
    try {
      await prisma.matchSet.deleteMany({ where: { matchId: mid } })
      const updated = await prisma.match.update({
        where: { id: mid },
        data: {
          matchDate: matchDate ? new Date(matchDate) : undefined,
          opponentFirstName: opponentFirstName ? opponentFirstName.trim() : undefined,
          opponentLastName:  opponentLastName  ? opponentLastName.trim()  : undefined,
          note: note !== undefined ? (note ? note.trim() : null) : undefined,
          sets: {
            create: sets.map(s => ({
              setNumber: s.setNumber,
              playerScore: s.playerScore,
              opponentScore: s.opponentScore,
            })),
          },
        },
        include: { sets: { orderBy: { setNumber: 'asc' } }, user: { select: { firstName: true, lastName: true } } },
      })
      // BUG FIX : synchroniser le match miroir (scores inversés, même date/note).
      let mirrorId = null
      try {
        mirrorId = await findMirrorMatchId(updated)
        if (mirrorId) {
          await prisma.matchSet.deleteMany({ where: { matchId: mirrorId } })
          await prisma.match.update({
            where: { id: mirrorId },
            data: {
              matchDate: updated.matchDate, note: updated.note,
              sets: { create: updated.sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
            },
          })
        }
      } catch (mirrorErr) { console.error('[admin/match edit — sync miroir]', mirrorErr) }
      return res.status(200).json({ ok: true, match: updated, mirrorMatchId: mirrorId })
    } catch (err) {
      console.error('[admin/match edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'refresh_ranking') {
    const freeze = req.body.freeze !== false
    try {
      if (!freeze) {
        await prisma.tournamentState.update({ where: { id: 1 }, data: { rankingSnapshot: null } })
        return res.status(200).json({ ok: true, message: 'Classement remis en live.' })
      }

      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, isBot: false, username: { notIn: ADMIN_USERNAMES } },
        select: {
          id: true, username: true, firstName: true, lastName: true, category: true, createdAt: true,
          matches: { where: { published: true }, include: { sets: true } },
          pouleMembers: { select: { pouleId: true } },
        },
      })

      const poules = await prisma.poule.findMany({
        include: { members: { include: { user: { select: { id: true } } } } },
      })
      const phase2Groups = await prisma.phase2Group.findMany({
        include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } } } },
      })

      const userPouleMap = {}
      for (const p of poules) for (const m of p.members) userPouleMap[m.userId] = p.id

      const players = users.map(u => ({
        id: u.id, username: u.username,
        firstName: u.firstName, lastName: u.lastName,
        category: u.category, createdAt: u.createdAt,
        pouleId: userPouleMap[u.id] || null,
        ...computeStats(u.matches),
      }))

      const poulesWithStats = poules.map(p => {
        const memberIds = new Set(p.members.map(m => m.userId))
        const poulePlayers = players.filter(pl => memberIds.has(pl.id))
        return {
          id: p.id, name: p.name, phase: p.phase,
          totalPoints: poulePlayers.reduce((a, pl) => a + pl.points, 0),
          totalWins:   poulePlayers.reduce((a, pl) => a + pl.wins, 0),
          members: sortPlayers(poulePlayers),
        }
      })

      const snapshot = JSON.stringify({ players: sortPlayers(players), poules: poulesWithStats, phase2Groups })
      await prisma.tournamentState.upsert({
        where: { id: 1 }, update: { rankingSnapshot: snapshot },
        create: { id: 1, currentPhase: 'PHASE1', rankingSnapshot: snapshot },
      })
      return res.status(200).json({ ok: true, message: 'Classement figé.' })
    } catch (err) {
      console.error('[admin/match refresh_ranking]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add') {
    const { userId, phase, round, matchDate, opponentId, opponentFirstName, opponentLastName, note, sets } = req.body

    if (!userId || !phase || !matchDate)
      return res.status(400).json({ error: 'Champs requis manquants.' })

    const validPhases = ['PHASE0', 'PHASE1', 'PHASE2']
    if (!validPhases.includes(phase))
      return res.status(400).json({ error: 'Phase invalide.' })

    if (phase === 'PHASE2') {
      const r = parseInt(round, 10)
      if (!r || r < 1) return res.status(400).json({ error: 'Numéro de ronde requis pour la Phase 2.' })
    }

    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    { const setsErr = validateSetScores(sets); if (setsErr) return res.status(400).json({ error: setsErr }) }

    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })

    const player = await prisma.user.findUnique({ where: { id: uid } })
    if (!player || !player.accepted || player.banned)
      return res.status(404).json({ error: 'Joueur introuvable ou inactif.' })
    if (ADMIN_USERNAMES.includes(player.username.toLowerCase()))
      return res.status(403).json({ error: "Impossible d'ajouter un match à un compte admin." })

    let oppFn, oppLn, oppUser = null
    if (opponentId) {
      const oppId = parseInt(opponentId, 10)
      oppUser = await prisma.user.findUnique({ where: { id: oppId } })
      if (!oppUser) return res.status(404).json({ error: 'Adversaire introuvable.' })
      oppFn = oppUser.firstName
      oppLn = oppUser.lastName
    } else {
      if (!opponentFirstName || !opponentLastName)
        return res.status(400).json({ error: 'Adversaire requis (opponentId ou prénom+nom).' })
      oppFn = opponentFirstName.trim()
      oppLn = opponentLastName.trim()
      oppUser = await prisma.user.findFirst({
        where: {
          firstName: { equals: oppFn, mode: 'insensitive' },
          lastName:  { equals: oppLn, mode: 'insensitive' },
          accepted: true, banned: false,
          username: { notIn: ADMIN_USERNAMES },
        },
      })
    }

    try {
      const matchDateObj = new Date(matchDate)
      const roundInt = phase === 'PHASE2' ? parseInt(round, 10) : null

      let specialMatchId = null
      let notInSpecials = false
      const openSpecials = await prisma.specialMatch.findMany({ where: { resolved: false } })

      if (openSpecials.length > 0) {
        const sm = openSpecials.find(s => {
          const i1 = s.player1Id === uid || s.player2Id === uid
          const oppId2 = oppUser?.id
          const i2 = oppId2 && (s.player1Id === oppId2 || s.player2Id === oppId2)
          return i1 && i2
        })
        if (sm) {
          specialMatchId = sm.id
          await prisma.specialMatch.update({ where: { id: sm.id }, data: { resolved: true } })
        } else { notInSpecials = true }
      } else { notInSpecials = true }

      const mainMatch = await prisma.match.create({
        data: {
          userId: uid, phase, roundNumber: roundInt,
          matchDate: matchDateObj,
          opponentFirstName: oppFn, opponentLastName: oppLn,
          note: note ? note.trim() : null,
          published: false, specialMatchId,
          sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
        },
        include: { sets: true },
      })

      let mirrorMatch = null
      if (oppUser && !ADMIN_USERNAMES.includes(oppUser.username.toLowerCase())) {
        mirrorMatch = await prisma.match.create({
          data: {
            userId: oppUser.id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: player.firstName, opponentLastName: player.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        })
      }

      return res.status(201).json({
        ok: true, match: mainMatch, mirrorMatch,
        mirrorCreated: !!mirrorMatch, notInSpecials,
        warning: notInSpecials ? "Ce match n'est pas répertorié dans les rencontres en cours." : null,
      })
    } catch (err) {
      console.error('[admin/match add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_from_special') {
    const { specialMatchId, matchDate, note, sets } = req.body

    const smid = parseInt(specialMatchId, 10)
    if (isNaN(smid)) return res.status(400).json({ error: 'specialMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    { const setsErr = validateSetScores(sets); if (setsErr) return res.status(400).json({ error: setsErr }) }

    try {
      const sm = await prisma.specialMatch.findUnique({ where: { id: smid } })
      if (!sm) return res.status(404).json({ error: 'Rencontre spéciale introuvable.' })
      if (sm.resolved) return res.status(400).json({ error: 'Cette rencontre est déjà résolue.' })

      const [p1, p2] = await Promise.all([
        prisma.user.findUnique({ where: { id: sm.player1Id } }),
        prisma.user.findUnique({ where: { id: sm.player2Id } }),
      ])
      if (!p1 || !p2) return res.status(404).json({ error: 'Joueur introuvable.' })

      const matchDateObj = new Date(matchDate)
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      const phase = state?.currentPhase || 'PHASE0'
      const roundInt = phase === 'PHASE2' ? state?.currentRound : null

      await prisma.specialMatch.update({ where: { id: smid }, data: { resolved: true } })

      const [m1, m2] = await Promise.all([
        prisma.match.create({
          data: {
            userId: sm.player1Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p2.firstName, opponentLastName: p2.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId: smid,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
          },
          include: { sets: true },
        }),
        prisma.match.create({
          data: {
            userId: sm.player2Id, phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: p1.firstName, opponentLastName: p1.lastName,
            note: note ? note.trim() : null,
            published: false, specialMatchId: smid,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        }),
      ])

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    } catch (err) {
      console.error('[admin/match add_from_special]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      // BUG FIX : supprimer aussi le match miroir.
      const match = await prisma.match.findUnique({ where: { id: mid }, include: { sets: true, user: { select: { firstName: true, lastName: true } } } })
      if (!match) return res.status(404).json({ error: 'Match introuvable.' })
      const mirrorId = await findMirrorMatchId(match).catch(() => null)
      const idsToDelete = mirrorId ? [mid, mirrorId] : [mid]
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'MATCH', idsToDelete)
        await tx.match.deleteMany({ where: { id: { in: idsToDelete } } })
        return v
      })
      return res.status(200).json({ ok: true, message: mirrorId ? 'Match supprimé (des deux côtés).' : 'Match supprimé.', mirrorDeleted: !!mirrorId, dataVersion: version })
    } catch (err) {
      console.error('[admin/match delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── notify_next_preview / notify_next_send ──────────────────────────────
  // "Notifier les joueurs de leur prochain match" (bouton de la liste globale
  // "Matchs planifiés"). Un joueur peut avoir plusieurs PlannedMatch à venir :
  // seul le plus proche dans le temps (par joueur, indépendamment de son
  // adversaire — cf. computeNextMatchTargets) est notifié et devient le match
  // "à renseigner" côté joueur (voir api/public.js, resource=convocations).
  if (action === 'notify_next_preview') {
    try {
      const targets = await computeNextMatchTargets()
      return res.status(200).json({
        ok: true,
        count: targets.length,
        preview: targets.map(t => ({
          userId: t.userId,
          playerName: `${t.user.firstName} ${t.user.lastName}`,
          opponentName: `${t.opponent.firstName} ${t.opponent.lastName}`,
          plannedMatchId: t.plannedMatch.id,
          scheduledDate: t.plannedMatch.scheduledDate,
          deadlineAt: t.plannedMatch.deadlineAt,
        })),
      })
    } catch (err) {
      console.error('[admin/match notify_next_preview]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'notify_next_send') {
    try {
      const targets = await computeNextMatchTargets()
      if (targets.length === 0) return res.status(200).json({ ok: true, count: 0 })

      let count = 0
      for (const t of targets) {
        const pm = t.plannedMatch
        const dateStr = pm.scheduledDate ? fmtDate(pm.scheduledDate) : null
        const deadlineStr = pm.deadlineAt ? fmtDateTime(pm.deadlineAt) : null
        const message = `Vous avez un match prévu avec ${t.opponent.firstName} ${t.opponent.lastName}${dateStr ? ` du ${dateStr}` : ''}${deadlineStr ? ` au ${deadlineStr}` : ''}.`

        await prisma.notification.create({
          data: {
            userId: t.userId, type: 'next_match', title: 'Prochain match programmé',
            message,
            opponentName: `${t.opponent.firstName} ${t.opponent.lastName}`,
            startDate: pm.scheduledDate, endDate: pm.deadlineAt,
            plannedMatchId: pm.id,
          },
        })
        // Push téléphone — onglet "score" (score du match)
        await sendPushToUser(prisma, t.userId, {
          title: '🏸 Nouveau match disponible',
          body: message,
          tab: 'score',
        }).catch(() => {})
        count++

        await prisma.schedulingLog.create({
          data: {
            phase: pm.phase, type: 'info',
            message: `Notification "prochain match" envoyée à ${t.user.firstName} ${t.user.lastName} (@${t.user.username}) — vs ${t.opponent.firstName} ${t.opponent.lastName}, match #${pm.id}${dateStr ? `, prévu le ${dateStr}` : ''}${deadlineStr ? `, deadline ${deadlineStr}` : ''}.`,
          },
        })

        if (!pm.notifiedAt) {
          await prisma.plannedMatch.update({ where: { id: pm.id }, data: { notifiedAt: new Date() } }).catch(() => {})
        }
      }

      // Bots : soumission immédiate du score — pas besoin du cycle
      // tick → read_notification → submit_score.
      // botSubmitScore crée les deux entrées Match ET supprime le PlannedMatch
      // en une transaction, donc on ne l'appelle qu'une seule fois par match,
      // même si les deux joueurs sont des bots.
      const botMatchesDone = new Set()
      for (const t of targets) {
        if (!t.user.isBot) continue
        const pmId = t.plannedMatch.id
        if (botMatchesDone.has(pmId)) continue
        botMatchesDone.add(pmId)
        await botSubmitScore({ botId: t.userId, payload: { plannedMatchId: pmId }, dueAt: new Date() }).catch(err => {
          console.error('[notify_next_send] botSubmitScore pmId='+pmId, err)
        })
      }

      return res.status(200).json({ ok: true, count })
    } catch (err) {
      console.error('[admin/match notify_next_send]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'planned_add') {
    const { player1Id, player2Id, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    if (!player1Id || !player2Id) return res.status(400).json({ error: 'Les deux joueurs sont requis.' })
    const p1id = parseInt(player1Id, 10)
    const p2id = parseInt(player2Id, 10)
    if (isNaN(p1id) || isNaN(p2id) || p1id === p2id)
      return res.status(400).json({ error: 'Joueurs invalides.' })
    try {
      let finalMalus = malus || null
      let finalMalusTarget = malusTarget ? parseInt(malusTarget, 10) : null

      const malusList = await loadMalusList()
      if (finalMalus === '__RANDOM__') {
        // Malus "Aléatoire" choisi par l'admin : on tire un malus concret dès l'enregistrement
        // en respectant les limites de concurrence
        finalMalus = await pickRandomMalusWithConcurrency(malusList)
        if (!finalMalusTarget) finalMalusTarget = Math.random() < 0.5 ? 1 : 2
      } else if (!finalMalus) {
        // Aucun malus fourni : vérifier si l'écart de classement déclenche un malus automatique
        const [p1, p2] = await Promise.all([
          prisma.user.findUnique({ where: { id: p1id }, select: { category: true } }),
          prisma.user.findUnique({ where: { id: p2id }, select: { category: true } }),
        ])
        const auto = computeAutoMalus(p1?.category, p2?.category, malusList)
        if (auto) {
          // Vérifier la limite de concurrence pour le malus auto
          if (await canAssignMalus(auto.malus)) {
            finalMalus = auto.malus; finalMalusTarget = auto.malusTarget
          } else {
            // Limite atteinte, choisir un autre malus disponible
            finalMalus = await pickRandomMalusWithConcurrency(malusList)
            finalMalusTarget = auto.malusTarget
          }
        }
      } else {
        // Malus spécifique choisi par l'admin : vérifier la limite de concurrence
        if (!(await canAssignMalus(finalMalus))) {
          // Limite atteinte pour ce malus — trouver un remplaçant
          const replacement = await pickRandomMalusWithConcurrency(malusList.filter(m => m !== finalMalus))
          if (replacement) finalMalus = replacement
          // Si pas de remplacement, on garde le malus choisi (l'admin a explicitement demandé)
        }
      }

      const pm = await prisma.plannedMatch.create({
        data: {
          player1Id: p1id,
          player2Id: p2id,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: finalMalus,
          malusTarget: finalMalusTarget,
          note: note ? note.trim() : null,
          phase: phase || 'PHASE1',
          roundNumber: phase === 'PHASE2' ? (parseInt(round, 10) || null) : null,
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
        },
      })
      return res.status(201).json({ ok: true, plannedMatch: pm })
    } catch (err) {
      console.error('[planned_add]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'planned_edit') {
    const { plannedMatchId, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      let finalMalus = malus || null
      let finalMalusTarget = malusTarget ? parseInt(malusTarget, 10) : null
      if (finalMalus === '__RANDOM__') {
        const malusList = await loadMalusList()
        finalMalus = await pickRandomMalusWithConcurrency(malusList)
        if (!finalMalusTarget) finalMalusTarget = Math.random() < 0.5 ? 1 : 2
      } else if (finalMalus) {
        // Malus spécifique : vérifier la limite de concurrence (en excluant le match courant)
        const currentPm = await prisma.plannedMatch.findUnique({ where: { id: pmid }, select: { malus: true } })
        if (currentPm?.malus !== finalMalus && !(await canAssignMalus(finalMalus))) {
          const malusList = await loadMalusList()
          const replacement = await pickRandomMalusWithConcurrency(malusList.filter(m => m !== finalMalus))
          if (replacement) finalMalus = replacement
        }
      }
      const pm = await prisma.plannedMatch.update({
        where: { id: pmid },
        data: {
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: finalMalus,
          malusTarget: finalMalusTarget,
          note: note ? note.trim() : null,
          phase: phase || 'PHASE1',
          roundNumber: phase === 'PHASE2' ? (parseInt(round, 10) || null) : null,
          // Modification du planning → on "dégrise" les boutons de notification
          // (site + WhatsApp) : les anciennes notifications/messages générés pour
          // ce match ne reflètent plus les infos à jour.
          notifiedAt: null,
          whatsappGeneratedAt: null,
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
        },
      })
      // Supprime les traces "déjà généré" liées à ce match pour que
      // computeNextMatchTargets / computeNextMatchWhatsappTargets le reproposent.
      await prisma.notification.deleteMany({ where: { plannedMatchId: pmid, type: 'next_match' } }).catch(() => {})
      await prisma.whatsappMessage.deleteMany({ where: { plannedMatchId: pmid, type: 'next_match', sent: false } }).catch(() => {})
      return res.status(200).json({ ok: true, plannedMatch: pm })
    } catch (err) {
      console.error('[planned_edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'planned_delete') {
    const pmid = parseInt(req.body.plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'PLANNED_MATCH', [pmid])
        await tx.plannedMatch.delete({ where: { id: pmid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[planned_delete]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  if (action === 'planned_convert') {
    const { plannedMatchId, matchDate, note, sets } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
    { const setsErr = validateSetScores(sets); if (setsErr) return res.status(400).json({ error: setsErr }) }

    try {
      const pm = await prisma.plannedMatch.findUnique({
        where: { id: pmid },
        include: {
          player1: true,
          player2: true,
        },
      })
      if (!pm) return res.status(404).json({ error: 'Match planifié introuvable.' })

      const matchDateObj = new Date(matchDate)
      const roundInt = pm.phase === 'PHASE2' ? pm.roundNumber : null

      const noteStr = note ? note.trim() : (pm.note || null)

      const [m1, m2] = await Promise.all([
        prisma.match.create({
          data: {
            userId: pm.player1Id, phase: pm.phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName,
            note: noteStr,
            published: false,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.playerScore, opponentScore: s.opponentScore })) },
          },
          include: { sets: true },
        }),
        prisma.match.create({
          data: {
            userId: pm.player2Id, phase: pm.phase, roundNumber: roundInt,
            matchDate: matchDateObj,
            opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName,
            note: noteStr,
            published: false,
            sets: { create: sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
          },
          include: { sets: true },
        }),
      ])

      await prisma.plannedMatch.delete({ where: { id: pmid } })

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    } catch (err) {
      console.error('[planned_convert]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'add_photos') {
    const { matchId, photos } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!Array.isArray(photos) || photos.length === 0)
      return res.status(400).json({ error: 'photos requis (array).' })
    try {
      const match = await prisma.match.findUnique({ where: { id: mid } })
      if (!match) return res.status(404).json({ error: 'Match introuvable.' })
      const created = await prisma.matchPhoto.createMany({
        data: photos.map(p => ({
          matchId: mid,
          url: p.url,
          publicId: p.publicId || null,
          caption: p.caption || null,
        })),
      })
      if (req.body.mirrorMatchId) {
        const mmid = parseInt(req.body.mirrorMatchId, 10)
        if (!isNaN(mmid)) {
          await prisma.matchPhoto.createMany({
            data: photos.map(p => ({
              matchId: mmid,
              url: p.url,
              publicId: p.publicId || null,
              caption: p.caption || null,
            })),
          })
        }
      }
      return res.status(201).json({ ok: true, count: created.count })
    } catch (err) {
      console.error('[admin/match add_photos]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_photo') {
    const pid = parseInt(req.body.photoId, 10)
    if (isNaN(pid)) return res.status(400).json({ error: 'photoId invalide.' })
    try {
      // BUG FIX : supprimer aussi la copie miroir de la photo.
      const photo = await prisma.matchPhoto.findUnique({ where: { id: pid } })
      if (!photo) return res.status(404).json({ error: 'Photo introuvable.' })
      let mirrorPhotoId = null
      try {
        const match = await prisma.match.findUnique({ where: { id: photo.matchId }, include: { user: { select: { firstName: true, lastName: true } } } })
        if (match) {
          const mirrorMatchId = await findMirrorMatchId(match)
          if (mirrorMatchId) {
            const mp = await prisma.matchPhoto.findFirst({ where: { matchId: mirrorMatchId, url: photo.url } })
            if (mp) mirrorPhotoId = mp.id
          }
        }
      } catch (mirrorErr) { console.error('[delete_photo — miroir]', mirrorErr) }
      const idsToDelete = mirrorPhotoId ? [pid, mirrorPhotoId] : [pid]
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'PHOTO', idsToDelete)
        await tx.matchPhoto.deleteMany({ where: { id: { in: idsToDelete } } })
        return v
      })
      return res.status(200).json({ ok: true, mirrorDeleted: !!mirrorPhotoId, dataVersion: version })
    } catch (err) {
      console.error('[delete_photo]', err)
      return res.status(500).json({ error: 'Erreur serveur ou photo introuvable.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}

/* ============================================================
 * SCHEDULING — planification automatique des matchs
 * ============================================================
 * resource=scheduling
 *   GET  ?phase=PHASE1|PHASE2                     → état complet (settings, blackouts, logs, poules, verrouillage)
 *   POST action=save_settings   { phase, cycleLengthDays, deadlineHoursBeforeCycleEnd, periodStart, periodEnd }
 *   POST action=save_blackout   { phase, label, dateStart, dateEnd }
 *   POST action=delete_blackout { blackoutId }
 *   POST action=compute_phase1  { answers? }       → génère le round-robin par poule (Phase 1)
 *   POST action=reset_phase1    {}                 → supprime les matchs planifiés Phase 1 et déverrouille
 *   POST action=console_command { phase, command } → interprète une commande texte de la console
 * ============================================================ */

const MS_PER_DAY = 24 * 60 * 60 * 1000

function addDays(date, days) { return new Date(date.getTime() + days * MS_PER_DAY) }
function addHours(date, hours) { return new Date(date.getTime() + hours * 60 * 60 * 1000) }
function fmtDate(d) { return new Date(d).toLocaleDateString('fr-FR') }

// Décale une date après la fin de toute période de non-jeu qui la contiendrait (en cascade,
// au cas où deux périodes se chevauchent ou se suivent immédiatement).
function shiftPastBlackouts(date, blackouts) {
  let cur = new Date(date)
  let moved = true
  let guard = 0
  while (moved && guard < 50) {
    moved = false
    guard++
    for (const bp of blackouts) {
      if (cur >= bp.dateStart && cur <= bp.dateEnd) {
        cur = addDays(bp.dateEnd, 1)
        moved = true
      }
    }
  }
  return cur
}

// Étend la deadline pour compenser les jours de blackout qui tombent
// à l'intérieur de la fenêtre [windowStart, deadline].
// Résultat : la fenêtre est coupée en deux (avant + après les vacances)
// tout en conservant le même nombre de jours jouables.
// Itère car l'extension peut elle-même chevaucher un autre blackout.
function extendDeadlineForBlackouts(windowStart, rawDeadline, blackouts) {
  let deadline = new Date(rawDeadline)
  let moved = true
  let guard = 0
  while (moved && guard < 50) {
    moved = false
    guard++
    for (const bp of blackouts) {
      const overlapStart = bp.dateStart > windowStart ? bp.dateStart : windowStart
      const overlapEnd   = bp.dateEnd   < deadline    ? bp.dateEnd   : deadline
      if (overlapStart <= overlapEnd) {
        const blackoutDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / MS_PER_DAY) + 1
        deadline = addDays(deadline, blackoutDays)
        moved = true
        break // relancer : l'extension peut chevaucher un autre blackout
      }
    }
  }
  return deadline
}

// Génère un calendrier round-robin (méthode du cercle) pour une liste d'IDs joueurs.
// Retourne un tableau de rondes, chaque ronde étant un tableau de paires [id1, id2].
// Si le nombre de joueurs est impair, un "bye" (null) tourne à chaque ronde.
function generateRoundRobinRounds(playerIds) {
  const arrBase = [...playerIds]
  if (arrBase.length % 2 !== 0) arrBase.push(null)
  const n = arrBase.length
  if (n < 2) return []
  const numRounds = n - 1
  let arr = arrBase.slice()
  const rounds = []
  for (let r = 0; r < numRounds; r++) {
    const pairs = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i]
      if (a !== null && b !== null) pairs.push([a, b])
    }
    rounds.push(pairs)
    const fixed = arr[0]
    const rest = arr.slice(1)
    rest.unshift(rest.pop())
    arr = [fixed, ...rest]
  }
  return rounds
}

// Construit l'ensemble des paires (userId1-userId2, triées) déjà jouées ou en attente de
// publication pour une phase donnée, à partir des Match existants (comparaison par nom, le
// modèle Match ne stocke pas d'opponentId — cf. planned_convert plus haut).
async function getExistingPairKeys(phase, members) {
  const idByName = new Map()
  for (const m of members) idByName.set(normPersonName(m.firstName) + '|' + normPersonName(m.lastName), m.id)

  const matches = await prisma.match.findMany({
    where: { phase, userId: { in: members.map(m => m.id) } },
    select: { userId: true, opponentFirstName: true, opponentLastName: true },
  })

  const keys = new Set()
  for (const m of matches) {
    const oppId = idByName.get(normPersonName(m.opponentFirstName) + '|' + normPersonName(m.opponentLastName))
    if (!oppId) continue
    const key = [m.userId, oppId].sort((a, b) => a - b).join('-')
    keys.add(key)
  }
  return keys
}

async function handleScheduling(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    const phase = req.query.phase === 'PHASE2' ? 'PHASE2' : 'PHASE1'
    try {
      const [settings, blackouts, logs, plannedCount, poules, groups, state, plannedMatchesRaw] = await Promise.all([
        prisma.schedulingSettings.findUnique({ where: { phase } }),
        prisma.blackoutPeriod.findMany({ where: { phase }, orderBy: { dateStart: 'asc' } }),
        prisma.schedulingLog.findMany({ where: { phase }, orderBy: { id: 'asc' } }),
        prisma.plannedMatch.count({ where: { phase } }),
        phase === 'PHASE1' ? prisma.poule.findMany({
          where: { phase },
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              where: { user: { active: true, accepted: true, banned: false } },
              include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } },
            },
          },
        }) : Promise.resolve([]),
        phase === 'PHASE2' ? prisma.phase2Group.findMany({
          orderBy: { createdAt: 'asc' },
          include: {
            members: {
              where: { user: { active: true, accepted: true, banned: false } },
              include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } },
            },
          },
        }) : Promise.resolve([]),
        prisma.tournamentState.upsert({ where: { id: 1 }, update: {}, create: { id: 1, currentPhase: 'PHASE0', currentRound: null } }),
        prisma.plannedMatch.findMany({
          where: { phase },
          orderBy: { scheduledDate: 'asc' },
          include: {
            player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          },
        }),
      ])

      // Rattache chaque match planifié à sa poule (Phase 1) ou son groupe (Phase 2) — les
      // deux joueurs d'un même match sont toujours dans la même poule/groupe — pour la
      // coloration du calendrier admin.
      const groupings = phase === 'PHASE1' ? poules : groups
      const groupIdByUser = new Map()
      for (const g of groupings) for (const m of g.members) groupIdByUser.set(m.userId, g.id)
      const plannedMatches = plannedMatchesRaw.map(pm => ({ ...pm, pouleId: groupIdByUser.get(pm.player1Id) || null }))

      return res.status(200).json({
        phase, settings, blackouts, logs, plannedCount, poules, groups, plannedMatches,
        currentPhase: state.currentPhase, currentRound: state.currentRound,
        locked: !!settings?.locked,
      })
    } catch (err) {
      console.error('[scheduling GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  if (action === 'save_settings') {
    const { phase, cycleLengthDays, deadlineHoursBeforeCycleEnd, periodStart, periodEnd } = req.body
    if (!['PHASE1', 'PHASE2'].includes(phase)) return res.status(400).json({ error: 'Phase invalide.' })
    if (!periodStart || !periodEnd) return res.status(400).json({ error: 'Période (début/fin) requise.' })
    const cycle = parseInt(cycleLengthDays, 10)
    const deadlineH = parseInt(deadlineHoursBeforeCycleEnd, 10)
    if (isNaN(cycle) || cycle < 1) return res.status(400).json({ error: 'Durée de cycle invalide.' })
    if (isNaN(deadlineH) || deadlineH < 0) return res.status(400).json({ error: 'Délai de deadline invalide.' })
    const start = new Date(periodStart), end = new Date(periodEnd)
    if (end <= start) return res.status(400).json({ error: 'La date de fin doit être après la date de début.' })

    try {
      const existing = await prisma.schedulingSettings.findUnique({ where: { phase } })
      if (existing?.locked) {
        return res.status(409).json({ error: 'Les paramètres sont verrouillés : supprimez d\'abord les matchs planifiés de cette phase pour les modifier.' })
      }
      const settings = await prisma.schedulingSettings.upsert({
        where: { phase },
        update: { cycleLengthDays: cycle, deadlineHoursBeforeCycleEnd: deadlineH, periodStart: start, periodEnd: end },
        create: { phase, cycleLengthDays: cycle, deadlineHoursBeforeCycleEnd: deadlineH, periodStart: start, periodEnd: end },
      })
      return res.status(200).json({ ok: true, settings })
    } catch (err) {
      console.error('[scheduling save_settings]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'save_blackout') {
    const { phase, label, dateStart, dateEnd } = req.body
    if (!['PHASE1', 'PHASE2'].includes(phase)) return res.status(400).json({ error: 'Phase invalide.' })
    if (!label?.trim() || !dateStart || !dateEnd) return res.status(400).json({ error: 'Libellé et dates requis.' })
    const start = new Date(dateStart), end = new Date(dateEnd)
    if (end < start) return res.status(400).json({ error: 'La date de fin doit être après la date de début.' })
    try {
      const bp = await prisma.blackoutPeriod.create({ data: { phase, label: label.trim(), dateStart: start, dateEnd: end } })
      // Une période de non-jeu ajoutée après génération doit être traitée comme une
      // régénération manuelle : on prévient l'admin dans la console plutôt que de
      // recalculer silencieusement (cf. cahier des charges).
      const settings = await prisma.schedulingSettings.findUnique({ where: { phase } })
      if (settings?.locked) {
        await prisma.schedulingLog.create({
          data: { phase, type: 'avertissement', message: `Période de non-jeu « ${label.trim()} » ajoutée alors que les matchs sont déjà générés. Relancez le calcul (il régénérera en tenant compte des scores déjà saisis) pour l'appliquer.` },
        })
      }
      return res.status(201).json({ ok: true, blackout: bp, needsRecompute: !!settings?.locked })
    } catch (err) {
      console.error('[scheduling save_blackout]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'delete_blackout') {
    const bid = parseInt(req.body.blackoutId, 10)
    if (isNaN(bid)) return res.status(400).json({ error: 'blackoutId invalide.' })
    try {
      const version = await prisma.$transaction(async (tx) => {
        const v = await logDeletion(tx, 'BLACKOUT', [bid])
        await tx.blackoutPeriod.delete({ where: { id: bid } })
        return v
      })
      return res.status(200).json({ ok: true, dataVersion: version })
    } catch (err) {
      console.error('[delete_blackout]', err)
      return res.status(500).json({ error: 'Erreur serveur ou période introuvable.' })
    }
  }

  if (action === 'reset_phase1') {
    try {
      await prisma.$transaction(async (tx) => {
        const toDelete = await tx.plannedMatch.findMany({ where: { phase: 'PHASE1' }, select: { id: true } })
        await logDeletion(tx, 'PLANNED_MATCH', toDelete.map(m => m.id), `Suppression de ${toDelete.length} match(s) planifié(s) Phase 1 (reset)`)
        await tx.plannedMatch.deleteMany({ where: { phase: 'PHASE1' } })
        await tx.schedulingSettings.updateMany({ where: { phase: 'PHASE1' }, data: { locked: false } })
        await tx.schedulingLog.create({
          data: { phase: 'PHASE1', type: 'action', message: 'Matchs planifiés Phase 1 supprimés — paramètres déverrouillés.' },
        })
      })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[scheduling reset_phase1]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'reset_phase2') {
    try {
      await prisma.$transaction(async (tx) => {
        const toDelete = await tx.plannedMatch.findMany({ where: { phase: 'PHASE2' }, select: { id: true } })
        await logDeletion(tx, 'PLANNED_MATCH', toDelete.map(m => m.id), `Suppression de ${toDelete.length} match(s) planifié(s) Phase 2 (reset)`)
        await tx.plannedMatch.deleteMany({ where: { phase: 'PHASE2' } })
        await tx.schedulingSettings.updateMany({ where: { phase: 'PHASE2' }, data: { locked: false } })
        await tx.schedulingLog.create({
          data: { phase: 'PHASE2', type: 'action', message: 'Matchs planifiés Phase 2 supprimés — paramètres déverrouillés.' },
        })
      })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[scheduling reset_phase2]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (action === 'compute_phase2_round') {
    return computePhase2Round(req, res, req.body?.answers || {}, null)
  }

  if (action === 'console_command') {
    return handleConsoleCommand(req, res)
  }

  if (action === 'compute_phase1') {
    return computePhase1(req, res, req.body?.answers || {})
  }

  if (action === 'move_planned_match') {
    const pmid = parseInt(req.body.plannedMatchId, 10)
    const { newDate } = req.body
    if (isNaN(pmid) || !newDate) return res.status(400).json({ error: 'plannedMatchId et newDate requis.' })
    const result = await movePlannedMatchCore(pmid, newDate)
    if (result.error) return res.status(result.status || 500).json({ error: result.error })
    return res.status(200).json({ ok: true, plannedMatch: result.plannedMatch, warning: result.warning })
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
// N'écrit les PlannedMatch en base que si le calcul se résout entièrement (pas de
// question ouverte) — sinon les logs (y compris la question) sont écrits mais aucun
// match n'est créé, et la fonction retourne needsInput:true.
async function computePhase1(req, res, answers) {
  const phase = 'PHASE1'
  const logEntries = []
  const log = (type, message) => logEntries.push({ phase, type, message })

  try {
    const [settings, dynamicMalusList] = await Promise.all([
      prisma.schedulingSettings.findUnique({ where: { phase } }),
      loadMalusList(),
    ])
    if (!settings) {
      log('erreur', 'Aucun paramètre de planification configuré pour la Phase 1. Configurez la période et le cycle avant de calculer.')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Paramètres manquants.', logs: logEntries })
    }

    const [blackouts, poules] = await Promise.all([
      prisma.blackoutPeriod.findMany({ where: { phase }, orderBy: { dateStart: 'asc' } }),
      prisma.poule.findMany({
        where: { phase },
        orderBy: { createdAt: 'asc' },
        include: {
          members: {
            where: { user: { active: true, accepted: true, banned: false } },
            include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } },
          },
        },
      }),
    ])

    if (poules.length === 0) {
      log('erreur', 'Aucune poule définie pour la Phase 1.')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Aucune poule.', logs: logEntries })
    }

    log('info', `Début du calcul Phase 1 — période du ${fmtDate(settings.periodStart)} au ${fmtDate(settings.periodEnd)}, cycle de ${settings.cycleLengthDays} jour(s), deadline ${settings.deadlineHoursBeforeCycleEnd}h avant la fin de chaque cycle.`)
    if (blackouts.length > 0) {
      log('info', `${blackouts.length} période(s) de non-jeu prise(s) en compte : ${blackouts.map(b => `${b.label} (${fmtDate(b.dateStart)}→${fmtDate(b.dateEnd)})`).join(', ')}.`)
    }

    // Round-robin par poule (données brutes, sans dates pour l'instant)
    const pouleData = []
    let maxRounds = 0
    for (const p of poules) {
      const members = p.members.map(m => m.user)
      if (members.length < 2) {
        log('avertissement', `Poule « ${p.name} » : moins de 2 joueurs actifs — ignorée.`)
        continue
      }
      const existingKeys = await getExistingPairKeys(phase, members)
      const rounds = generateRoundRobinRounds(members.map(m => m.id))
      const byId = new Map(members.map(m => [m.id, m]))
      let totalPairs = 0, excludedPairs = 0
      const filteredRounds = rounds.map(roundPairs => roundPairs.filter(([a, b]) => {
        totalPairs++
        const key = [a, b].sort((x, y) => x - y).join('-')
        if (existingKeys.has(key)) { excludedPairs++; return false }
        return true
      }))
      maxRounds = Math.max(maxRounds, filteredRounds.length)
      if (members.length % 2 !== 0) log('info', `Poule « ${p.name} » : ${members.length} joueurs (nombre impair) — un exempt tournant par ronde.`)
      log('info', `Poule « ${p.name} » : ${members.length} joueurs, ${filteredRounds.length} ronde(s), ${totalPairs - excludedPairs} match(s) à créer${excludedPairs ? ` (${excludedPairs} paire(s) déjà jouée(s) ou en attente de publication, exclue(s))` : ''}.`)
      pouleData.push({ poule: p, byId, filteredRounds })
    }

    if (maxRounds === 0) {
      log('erreur', 'Aucune ronde à planifier (poules vides ou toutes les paires déjà jouées).')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Rien à planifier.', logs: logEntries })
    }

    // Dates de ronde, communes à toutes les poules, avec décalage en cascade sur les périodes de non-jeu
    const roundDates = []
    let cursor = new Date(settings.periodStart)
    for (let r = 0; r < maxRounds; r++) {
      if (r > 0) cursor = addDays(cursor, settings.cycleLengthDays)
      const raw = new Date(cursor)
      const shifted = shiftPastBlackouts(cursor, blackouts)
      if (shifted.getTime() !== raw.getTime()) {
        log('avertissement', `Ronde ${r + 1} : initialement prévue le ${fmtDate(raw)}, tombe dans une période de non-jeu — décalée au ${fmtDate(shifted)}.`)
      } else {
        log('info', `Ronde ${r + 1} : ${fmtDate(shifted)}.`)
      }
      cursor = shifted
      roundDates.push(new Date(cursor))
    }

    const lastDeadline = addHours(addDays(roundDates[roundDates.length - 1], settings.cycleLengthDays), -settings.deadlineHoursBeforeCycleEnd)
    if (lastDeadline > settings.periodEnd) {
      log('avertissement', `La deadline de la dernière ronde (${fmtDate(lastDeadline)}) dépasse la fin de période prévue (${fmtDate(settings.periodEnd)}).`)
      if (!answers.overrun) {
        log('question', 'Comment souhaitez-vous résoudre ce dépassement ?')
        await flushLogs(phase, logEntries)
        return res.status(200).json({
          ok: false, needsInput: true,
          questions: [{ key: 'overrun', question: 'La planification dépasse la date de fin de période. Que faire ?', options: [
            { value: 'extend', label: `Étendre automatiquement la fin de période au ${fmtDate(lastDeadline)}` },
            { value: 'abort', label: 'Annuler — je vais ajuster les paramètres ou les périodes de non-jeu moi-même' },
          ] }],
          logs: logEntries,
        })
      }
      if (answers.overrun === 'abort') {
        log('action', 'Calcul annulé par l\'administrateur — aucun match créé.')
        await flushLogs(phase, logEntries)
        return res.status(200).json({ ok: false, aborted: true, logs: logEntries })
      }
      if (answers.overrun === 'extend') {
        await prisma.schedulingSettings.update({ where: { phase }, data: { periodEnd: lastDeadline } })
        log('reponse', `Fin de période étendue automatiquement au ${fmtDate(lastDeadline)}.`)
      }
    }

    // Construction des PlannedMatch
    const toCreate = []
    for (const { poule, byId, filteredRounds } of pouleData) {
      filteredRounds.forEach((roundPairs, rIdx) => {
        const scheduledDate = roundDates[rIdx]
        const rawDeadline = addHours(addDays(scheduledDate, settings.cycleLengthDays), -settings.deadlineHoursBeforeCycleEnd)
        const deadlineAt = extendDeadlineForBlackouts(scheduledDate, rawDeadline, blackouts)
        for (const [a, b] of roundPairs) {
          const p1 = byId.get(a), p2 = byId.get(b)
          const auto = computeAutoMalus(p1.category, p2.category, dynamicMalusList)
          toCreate.push({
            player1Id: a, player2Id: b, phase, scheduledDate, deadlineAt,
            malus: auto?.malus || null, malusTarget: auto?.malusTarget || null,
          })
          if (auto) log('info', `Malus automatique appliqué : ${p1.firstName} ${p1.lastName} vs ${p2.firstName} ${p2.lastName} (écart de classement ${p1.category}/${p2.category}).`)
        }
      })
    }

    await prisma.plannedMatch.createMany({ data: toCreate })

    // Appliquer les limites de concurrence des malus après la création groupée
    let malusReassigned = 0
    try {
      const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
      if (state?.malusConfig) {
        const cfg = JSON.parse(state.malusConfig)
        if (Array.isArray(cfg)) {
          const r1 = await enforceMalusConcurrency(cfg)
          malusReassigned = r1.reassigned
          // BUG FIX : messages dans logEntries pour survivre au flushLogs().
          for (const lm of r1.logMessages) {
            if (lm.phase === phase) log(lm.type, lm.message)
            else await prisma.schedulingLog.create({ data: lm }).catch(() => {})
          }
          if (r1.reassigned > 0) log('info', `${r1.reassigned} match(s) réassigné(s) pour respecter les limites de malus (détail ci-dessus).`)
        }
      }
    } catch (e) {
      console.error('[computePhase1 enforceMalusConcurrency]', e)
    }

    await prisma.schedulingSettings.update({ where: { phase }, data: { locked: true } })
    log('action', `${toCreate.length} match(s) planifié(s) créé(s) pour la Phase 1. Paramètres verrouillés.${malusReassigned > 0 ? ` ${malusReassigned} match(s) réassigné(s) pour les limites de malus.` : ''}`)

    await flushLogs(phase, logEntries)
    return res.status(201).json({ ok: true, count: toCreate.length, logs: logEntries })
  } catch (err) {
    console.error('[computePhase1]', err)
    log('erreur', `Erreur inattendue : ${err.message}`)
    await flushLogs(phase, logEntries).catch(() => {})
    return res.status(500).json({ ok: false, error: 'Erreur serveur.', logs: logEntries })
  }
}

// Remplace le fil de logs actif d'une phase par la nouvelle liste (un seul fil par phase).
async function flushLogs(phase, entries) {
  await prisma.schedulingLog.deleteMany({ where: { phase } })
  if (entries.length > 0) {
    await prisma.schedulingLog.createMany({ data: entries.map(e => ({ phase: e.phase, type: e.type, message: e.message })) })
  }
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Détermine, pour chaque joueur ayant au moins un match planifié daté et non
// forfait, son "prochain match" (le plus proche dans le temps) — tous phases
// confondues, cohérent avec la liste globale "Matchs planifiés (à venir)".
// C'est volontairement PAR JOUEUR et non par match : les deux adversaires d'un
// même PlannedMatch peuvent avoir des "prochains matchs" différents si l'un
// des deux a un autre match encore plus proche ailleurs (cf. réponse admin).
// Le statut "déjà notifié" est tracé via l'existence d'une Notification
// (type='next_match', plannedMatchId, userId) plutôt que via PlannedMatch.notifiedAt,
// pour permettre une notification asymétrique (un seul des deux joueurs) sans
// bloquer l'autre plus tard. PlannedMatch.notifiedAt reste mis à jour pour la
// première notification envoyée sur ce match, à titre informatif (console).
async function computeNextMatchTargets() {
  const matches = await prisma.plannedMatch.findMany({
    where: { forfeited: false, scheduledDate: { not: null } },
    orderBy: { scheduledDate: 'asc' },
    include: {
      player1: { select: { id: true, firstName: true, lastName: true, username: true, isBot: true } },
      player2: { select: { id: true, firstName: true, lastName: true, username: true, isBot: true } },
    },
  })

  const nextByUser = new Map() // userId -> plannedMatch le plus proche (le premier rencontré, déjà trié)
  for (const pm of matches) {
    if (!nextByUser.has(pm.player1Id)) nextByUser.set(pm.player1Id, pm)
    if (!nextByUser.has(pm.player2Id)) nextByUser.set(pm.player2Id, pm)
  }
  if (nextByUser.size === 0) return []

  const candidateMatchIds = [...new Set([...nextByUser.values()].map(pm => pm.id))]
  const alreadySent = await prisma.notification.findMany({
    where: { type: 'next_match', plannedMatchId: { in: candidateMatchIds } },
    select: { userId: true, plannedMatchId: true },
  })
  const sentKeys = new Set(alreadySent.map(n => `${n.plannedMatchId}-${n.userId}`))

  const targets = []
  for (const [userId, pm] of nextByUser) {
    if (sentKeys.has(`${pm.id}-${userId}`)) continue
    const isP1 = pm.player1Id === userId
    targets.push({ userId, user: isP1 ? pm.player1 : pm.player2, opponent: isP1 ? pm.player2 : pm.player1, plannedMatch: pm })
  }
  return targets
}

function parseConsoleDate(str) {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return null
}

async function getGroupingsForPhase(ph) {
  if (ph === 'PHASE1') {
    return prisma.poule.findMany({
      where: { phase: 'PHASE1' },
      include: { members: { where: { user: { active: true, accepted: true, banned: false } }, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } } } },
    })
  }
  return prisma.phase2Group.findMany({
    include: { members: { where: { user: { active: true, accepted: true, banned: false } }, include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } } } },
  })
}

// Logique de déplacement partagée entre le glisser-déposer du calendrier et la commande
// console "deplacer" — libre et isolée, jamais bloquante (cf. §3 du cahier des charges).
async function movePlannedMatchCore(pmid, newDate) {
  const pm = await prisma.plannedMatch.findUnique({
    where: { id: pmid },
    include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
  })
  if (!pm) return { error: 'Match planifié introuvable.', status: 404 }

  const target = new Date(newDate)
  const [settings, blackouts] = await Promise.all([
    prisma.schedulingSettings.findUnique({ where: { phase: pm.phase } }),
    prisma.blackoutPeriod.findMany({ where: { phase: pm.phase } }),
  ])

  let warning = null
  if (settings && (target < settings.periodStart || target > settings.periodEnd)) {
    warning = `Le ${fmtDate(target)} est hors de la période de planification définie (${fmtDate(settings.periodStart)} → ${fmtDate(settings.periodEnd)}).`
  } else {
    const inBlackout = blackouts.find(b => target >= b.dateStart && target <= b.dateEnd)
    if (inBlackout) warning = `Le ${fmtDate(target)} tombe dans la période de non-jeu « ${inBlackout.label} ».`
  }

  const wasNotified = !!pm.notifiedAt
  // BUG FIX : recalculer la deadline depuis la nouvelle date + invalider notifications.
  const newDeadlineAt = settings
    ? addHours(addDays(target, settings.cycleLengthDays), -settings.deadlineHoursBeforeCycleEnd)
    : pm.deadlineAt
  const updated = await prisma.plannedMatch.update({
    where: { id: pmid },
    data: { scheduledDate: target, deadlineAt: newDeadlineAt, notifiedAt: null, whatsappGeneratedAt: null },
  })
  if (wasNotified) {
    await prisma.notification.deleteMany({ where: { plannedMatchId: pmid, type: 'next_match' } }).catch(() => {})
    await prisma.whatsappMessage.deleteMany({ where: { plannedMatchId: pmid, type: 'next_match', sent: false } }).catch(() => {})
  }
  await prisma.schedulingLog.create({
    data: {
      phase: pm.phase, type: warning ? 'avertissement' : 'action',
      message: warning
        ? `Match #${pmid} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) déplacé au ${fmtDate(target)} — ${warning}`
        : `Match #${pmid} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) déplacé au ${fmtDate(target)}.`,
    },
  })
  if (wasNotified) {
    await prisma.schedulingLog.create({
      data: { phase: pm.phase, type: 'avertissement', message: `Ce match avait déjà été notifié aux joueurs le ${fmtDate(pm.notifiedAt)} — notification invalidée suite au déplacement. Pensez à renotifier (« notifier ${pmid} »).` },
    })
  }
  return { ok: true, plannedMatch: updated, warning }
}

/* ============================================================
 * CONSOLE — interprétation des commandes texte de la console de planification.
 * Organisée en quatre familles : diagnostic (lecture seule), actions ciblées sur un
 * match précis, notifications, et calcul/verrouillage. Voir "aide" pour la liste.
 * ============================================================ */
async function handleConsoleCommand(req, res) {
  const { phase, command } = req.body
  const ph = phase === 'PHASE2' ? 'PHASE2' : 'PHASE1'
  const raw = (command || '').trim()
  const cmd = raw.toLowerCase()
  await prisma.schedulingLog.create({ data: { phase: ph, type: 'commande', message: raw } })
  const say = (type, message) => prisma.schedulingLog.create({ data: { phase: ph, type, message } })

  try {
    // ── aide ──
    if (cmd === 'aide' || cmd === 'help') {
      await say('info', [
        'Diagnostic  : verifier · deadlines · alerte · liste · joueur <pseudo> · poule <nom>',
        'Actions     : annuler <id> · forfait <id> · deadline <id> <heures> · deplacer <id> <jj/mm/aaaa>',
        'Notifs      : notifier <id>',
        'Calcul      : statut · calculer · recalculer ronde <n> (Phase 2) · supprimer matchs · verrouiller · deverrouiller',
        'Export      : exporter',
      ].join('\n'))
      return res.status(200).json({ ok: true })
    }

    // ── liste ── liste des matchs planifiés de la phase avec leur id (pour
    // pouvoir alimenter les autres commandes qui demandent un <id>).
    if (cmd === 'liste') {
      const matches = await prisma.plannedMatch.findMany({
        where: { phase: ph },
        orderBy: { scheduledDate: 'asc' },
        include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
      })
      if (matches.length === 0) { await say('info', 'Aucun match planifié pour cette phase.'); return res.status(200).json({ ok: true }) }
      await say('info', `${matches.length} match(s) planifié(s) :`)
      for (const pm of matches) {
        await say('info', `  #${pm.id} — ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} — ${pm.scheduledDate ? fmtDate(pm.scheduledDate) : 'date non définie'}${pm.deadlineAt ? ` (deadline ${fmtDateTime(pm.deadlineAt)})` : ''}${pm.notifiedAt ? ' · notifié' : ''}${pm.forfeited ? ' · forfait' : ''}`)
      }
      return res.status(200).json({ ok: true })
    }

    // ── statut ──
    if (cmd === 'statut') {
      const [settings, plannedCount] = await Promise.all([
        prisma.schedulingSettings.findUnique({ where: { phase: ph } }),
        prisma.plannedMatch.count({ where: { phase: ph } }),
      ])
      const msg = settings
        ? `Période ${fmtDate(settings.periodStart)} → ${fmtDate(settings.periodEnd)} · cycle ${settings.cycleLengthDays}j · ${plannedCount} match(s) planifié(s) · ${settings.locked ? 'verrouillé' : 'non verrouillé'}.`
        : 'Aucun paramètre configuré pour cette phase.'
      await say('info', msg)
      return res.status(200).json({ ok: true })
    }

    // ── calculer ──
    if (cmd === 'calculer') {
      if (ph === 'PHASE1') return computePhase1(req, res, {})
      return computePhase2Round(req, res, {}, null)
    }

    // ── supprimer matchs ──
    if (cmd === 'supprimer matchs') {
      await prisma.plannedMatch.deleteMany({ where: { phase: ph } })
      await prisma.schedulingSettings.updateMany({ where: { phase: ph }, data: { locked: false } })
      await say('action', 'Matchs planifiés supprimés via la console — paramètres déverrouillés.')
      return res.status(200).json({ ok: true })
    }

    // ── verrouiller / deverrouiller ──
    if (cmd === 'verrouiller') {
      await prisma.schedulingSettings.updateMany({ where: { phase: ph }, data: { locked: true } })
      await say('action', 'Paramètres verrouillés manuellement.')
      return res.status(200).json({ ok: true })
    }
    if (cmd === 'deverrouiller') {
      await prisma.schedulingSettings.updateMany({ where: { phase: ph }, data: { locked: false } })
      await say('avertissement', 'Paramètres déverrouillés manuellement — les matchs planifiés existants sont conservés. Attention à la cohérence si vous relancez un calcul complet.')
      return res.status(200).json({ ok: true })
    }

    // ── verifier ──
    if (cmd === 'verifier') {
      const [planned, blackouts] = await Promise.all([
        prisma.plannedMatch.findMany({ where: { phase: ph }, include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } } }),
        prisma.blackoutPeriod.findMany({ where: { phase: ph } }),
      ])
      let issues = 0
      const seen = new Map()
      for (const pm of planned) {
        const key = [pm.player1Id, pm.player2Id].sort((a, b) => a - b).join('-')
        if (seen.has(key)) { issues++; await say('avertissement', `Doublon : ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} apparaît plusieurs fois (matchs #${seen.get(key)} et #${pm.id}).`) }
        else seen.set(key, pm.id)
      }
      for (const pm of planned) {
        if (!pm.scheduledDate) continue
        const bp = blackouts.find(b => pm.scheduledDate >= b.dateStart && pm.scheduledDate <= b.dateEnd)
        if (bp) { issues++; await say('avertissement', `Match #${pm.id} (${pm.player1.firstName} vs ${pm.player2.firstName}) planifié le ${fmtDate(pm.scheduledDate)}, dans la période de non-jeu « ${bp.label} » (probablement ajoutée après coup).`) }
      }
      const countByUser = new Map()
      for (const pm of planned) {
        countByUser.set(pm.player1Id, (countByUser.get(pm.player1Id) || 0) + 1)
        countByUser.set(pm.player2Id, (countByUser.get(pm.player2Id) || 0) + 1)
      }
      if (countByUser.size > 0) {
        const counts = [...countByUser.values()]
        const max = Math.max(...counts), min = Math.min(...counts)
        if (max - min >= 2) { issues++; await say('avertissement', `Répartition inégale : entre ${min} et ${max} match(s) restant(s) selon les joueurs.`) }
      }
      await say('info', issues === 0 ? 'Aucune anomalie détectée.' : `${issues} anomalie(s) signalée(s) ci-dessus.`)
      return res.status(200).json({ ok: true })
    }

    // ── deadlines ──
    if (cmd === 'deadlines') {
      const overdue = await prisma.plannedMatch.findMany({
        where: { phase: ph, forfeited: false, deadlineAt: { lt: new Date() } },
        include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
        orderBy: { deadlineAt: 'asc' },
      })
      if (overdue.length === 0) { await say('info', 'Aucun match en dépassement de deadline.'); return res.status(200).json({ ok: true }) }
      for (const pm of overdue) await say('avertissement', `Match #${pm.id} : ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} — deadline dépassée le ${fmtDateTime(pm.deadlineAt)}, score non saisi.`)
      await say('info', `${overdue.length} forfait(s) potentiel(s) — utilisez "forfait <id>" pour trancher.`)
      return res.status(200).json({ ok: true })
    }

    // ── alerte ──
    if (cmd === 'alerte') {
      const now = new Date()
      const upcoming = await prisma.plannedMatch.findMany({
        where: { phase: ph, notifiedAt: null, deadlineAt: { gte: now, lte: addHours(now, 48) } },
        include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
        orderBy: { deadlineAt: 'asc' },
      })
      if (upcoming.length === 0) { await say('info', 'Aucune deadline dans les 48h à venir parmi les matchs non notifiés.'); return res.status(200).json({ ok: true }) }
      for (const pm of upcoming) await say('avertissement', `Match #${pm.id} : ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} — deadline le ${fmtDateTime(pm.deadlineAt)}, jamais notifié (« notifier ${pm.id} »).`)
      return res.status(200).json({ ok: true })
    }

    // ── joueur <pseudo> ──
    if (cmd.startsWith('joueur ')) {
      const username = raw.slice(7).trim()
      if (!username) { await say('erreur', 'Usage : joueur <pseudo>'); return res.status(200).json({ ok: true }) }
      const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })
      if (!user) { await say('erreur', `Joueur « ${username} » introuvable.`); return res.status(200).json({ ok: true }) }
      const matches = await prisma.plannedMatch.findMany({
        where: { phase: ph, OR: [{ player1Id: user.id }, { player2Id: user.id }] },
        include: { player1: { select: { id: true, firstName: true, lastName: true } }, player2: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { scheduledDate: 'asc' },
      })
      if (matches.length === 0) { await say('info', `${user.firstName} ${user.lastName} n'a aucun match planifié pour cette phase.`); return res.status(200).json({ ok: true }) }
      await say('info', `Calendrier de ${user.firstName} ${user.lastName} (@${user.username}) :`)
      for (const pm of matches) {
        const opp = pm.player1Id === user.id ? pm.player2 : pm.player1
        await say('info', `  #${pm.id} — vs ${opp.firstName} ${opp.lastName} — ${pm.scheduledDate ? fmtDate(pm.scheduledDate) : 'date non définie'}${pm.deadlineAt ? ` (deadline ${fmtDateTime(pm.deadlineAt)})` : ''}${pm.malus ? ' — malus' : ''}`)
      }
      return res.status(200).json({ ok: true })
    }

    // ── poule <nom> / groupe <nom> ──
    if (cmd.startsWith('poule ') || cmd.startsWith('groupe ')) {
      const name = raw.slice(cmd.startsWith('poule ') ? 6 : 7).trim()
      if (!name) { await say('erreur', 'Usage : poule <nom>'); return res.status(200).json({ ok: true }) }
      const groupings = await getGroupingsForPhase(ph)
      const g = groupings.find(x => x.name.toLowerCase() === name.toLowerCase())
      if (!g) { await say('erreur', `Poule/groupe « ${name} » introuvable pour cette phase.`); return res.status(200).json({ ok: true }) }
      const members = g.members.map(m => m.user)
      const matches = await prisma.match.findMany({ where: { phase: ph, userId: { in: members.map(m => m.id) }, published: true }, include: { sets: true } })
      const byUser = new Map(members.map(m => [m.id, []]))
      for (const m of matches) byUser.get(m.userId)?.push(m)
      const ranked = sortPlayers(members.map(m => ({ ...m, ...computeStats(byUser.get(m.id) || []) })))
      await say('info', `Poule/groupe « ${g.name} » — classement :`)
      let rank = 1
      for (const p of ranked) { await say('info', `  ${rank}. ${p.firstName} ${p.lastName} — ${p.wins}V/${p.losses}D — ${p.points} pts`); rank++ }
      const remaining = await prisma.plannedMatch.findMany({
        where: { phase: ph, player1Id: { in: members.map(m => m.id) } },
        include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
      })
      if (remaining.length === 0) { await say('info', 'Aucun match restant planifié.'); return res.status(200).json({ ok: true }) }
      await say('info', 'Matchs restants :')
      for (const pm of remaining) await say('info', `  #${pm.id} — ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} — ${pm.scheduledDate ? fmtDate(pm.scheduledDate) : '?'}`)
      return res.status(200).json({ ok: true })
    }

    // ── annuler <id> ──
    if (cmd.startsWith('annuler ')) {
      const id = parseInt(raw.slice(8).trim(), 10)
      if (isNaN(id)) { await say('erreur', 'Usage : annuler <id>'); return res.status(200).json({ ok: true }) }
      const pm = await prisma.plannedMatch.findUnique({ where: { id }, include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } } })
      if (!pm) { await say('erreur', `Match planifié #${id} introuvable.`); return res.status(200).json({ ok: true }) }
      await prisma.$transaction(async (tx) => {
        await logDeletion(tx, 'PLANNED_MATCH', [id])
        await tx.plannedMatch.delete({ where: { id } })
      })
      await say('action', `Match #${id} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) supprimé.`)
      return res.status(200).json({ ok: true })
    }

    // ── forfait <id> ──
    if (cmd.startsWith('forfait ')) {
      const id = parseInt(raw.slice(8).trim(), 10)
      if (isNaN(id)) { await say('erreur', 'Usage : forfait <id>'); return res.status(200).json({ ok: true }) }
      const pm = await prisma.plannedMatch.findUnique({ where: { id }, include: { player1: true, player2: true } })
      if (!pm) { await say('erreur', `Match planifié #${id} introuvable.`); return res.status(200).json({ ok: true }) }
      const matchDateObj = pm.scheduledDate || new Date()
      await Promise.all([
        prisma.match.create({ data: { userId: pm.player1Id, phase: pm.phase, roundNumber: pm.roundNumber, matchDate: matchDateObj, opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName, note: 'Forfait', published: true, sets: { create: [{ setNumber: 1, playerScore: 0, opponentScore: 0 }] } } }),
        prisma.match.create({ data: { userId: pm.player2Id, phase: pm.phase, roundNumber: pm.roundNumber, matchDate: matchDateObj, opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName, note: 'Forfait', published: true, sets: { create: [{ setNumber: 1, playerScore: 0, opponentScore: 0 }] } } }),
      ])
      await prisma.plannedMatch.delete({ where: { id } })
      await say('action', `Match #${id} (${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName}) déclaré forfait (0-0), publié, retiré des matchs planifiés.`)
      return res.status(200).json({ ok: true })
    }

    // ── deadline <id> <heures> ──
    if (cmd.startsWith('deadline ')) {
      const parts = raw.split(/\s+/)
      const id = parseInt(parts[1], 10), hours = parseFloat(parts[2])
      if (isNaN(id) || isNaN(hours)) { await say('erreur', 'Usage : deadline <id> <heures> (ex : "deadline 42 24" pour +24h, "deadline 42 -12" pour -12h)'); return res.status(200).json({ ok: true }) }
      const pm = await prisma.plannedMatch.findUnique({ where: { id } })
      if (!pm) { await say('erreur', `Match planifié #${id} introuvable.`); return res.status(200).json({ ok: true }) }
      const updated = addHours(pm.deadlineAt || new Date(), hours)
      await prisma.plannedMatch.update({ where: { id }, data: { deadlineAt: updated } })
      await say('action', `Deadline du match #${id} ${hours >= 0 ? 'reportée de' : 'avancée de'} ${Math.abs(hours)}h — nouvelle deadline : ${fmtDateTime(updated)}.`)
      return res.status(200).json({ ok: true })
    }

    // ── deplacer <id> <date> ──
    if (cmd.startsWith('deplacer ')) {
      const parts = raw.split(/\s+/)
      const id = parseInt(parts[1], 10)
      const parsed = parts[2] ? parseConsoleDate(parts[2]) : null
      if (isNaN(id) || !parsed) { await say('erreur', 'Usage : deplacer <id> <jj/mm/aaaa>'); return res.status(200).json({ ok: true }) }
      const result = await movePlannedMatchCore(id, parsed.toISOString())
      if (result.error) { await say('erreur', result.error); return res.status(200).json({ ok: true }) }
      return res.status(200).json({ ok: true })
    }

    // ── notifier <id> ──
    if (cmd.startsWith('notifier ')) {
      const id = parseInt(raw.slice(9).trim(), 10)
      if (isNaN(id)) { await say('erreur', 'Usage : notifier <id>'); return res.status(200).json({ ok: true }) }
      const pm = await prisma.plannedMatch.findUnique({ where: { id }, include: { player1: true, player2: true } })
      if (!pm) { await say('erreur', `Match planifié #${id} introuvable.`); return res.status(200).json({ ok: true }) }
      if (!pm.scheduledDate) { await say('erreur', `Le match #${id} n'a pas encore de date programmée.`); return res.status(200).json({ ok: true }) }
      const dateStr = fmtDate(pm.scheduledDate)
      const deadlineStr = pm.deadlineAt ? fmtDateTime(pm.deadlineAt) : null
      await Promise.all([
        prisma.notification.create({ data: { userId: pm.player1Id, type: 'next_match', title: 'Prochain match programmé', message: `Vous affrontez ${pm.player2.firstName} ${pm.player2.lastName} le ${dateStr}.${deadlineStr ? ` Merci de saisir le score avant le ${deadlineStr}.` : ''}`, opponentName: `${pm.player2.firstName} ${pm.player2.lastName}`, startDate: pm.scheduledDate, endDate: pm.deadlineAt, plannedMatchId: pm.id } }),
        prisma.notification.create({ data: { userId: pm.player2Id, type: 'next_match', title: 'Prochain match programmé', message: `Vous affrontez ${pm.player1.firstName} ${pm.player1.lastName} le ${dateStr}.${deadlineStr ? ` Merci de saisir le score avant le ${deadlineStr}.` : ''}`, opponentName: `${pm.player1.firstName} ${pm.player1.lastName}`, startDate: pm.scheduledDate, endDate: pm.deadlineAt, plannedMatchId: pm.id } }),
      ])
      await prisma.plannedMatch.update({ where: { id }, data: { notifiedAt: new Date() } })
      await say('action', `Notification "prochain match" envoyée à ${pm.player1.firstName} ${pm.player1.lastName} et ${pm.player2.firstName} ${pm.player2.lastName}.`)
      return res.status(200).json({ ok: true })
    }

    // ── recalculer ronde <n> ──
    if (cmd.startsWith('recalculer ronde ')) {
      if (ph !== 'PHASE2') { await say('erreur', 'La commande "recalculer ronde" ne concerne que la Phase 2.'); return res.status(200).json({ ok: true }) }
      const n = parseInt(raw.split(/\s+/)[2], 10)
      if (isNaN(n)) { await say('erreur', 'Usage : recalculer ronde <n>'); return res.status(200).json({ ok: true }) }
      await prisma.plannedMatch.deleteMany({ where: { phase: 'PHASE2', roundNumber: n } })
      await say('avertissement', `Matchs existants de la ronde ${n} supprimés — recalcul en cours.`)
      return computePhase2Round(req, res, req.body?.answers || {}, n)
    }

    // ── exporter ──
    if (cmd === 'exporter') {
      const matches = await prisma.plannedMatch.findMany({
        where: { phase: ph }, orderBy: { scheduledDate: 'asc' },
        include: { player1: { select: { firstName: true, lastName: true } }, player2: { select: { firstName: true, lastName: true } } },
      })
      const rows = matches.map(m => [m.id, m.scheduledDate ? fmtDate(m.scheduledDate) : '', `${m.player1.firstName} ${m.player1.lastName}`, `${m.player2.firstName} ${m.player2.lastName}`, m.deadlineAt ? fmtDateTime(m.deadlineAt) : '', m.malus || ''].join(';'))
      const csv = 'id;date;joueur1;joueur2;deadline;malus\n' + rows.join('\n')
      await say('action', `Export CSV généré (${matches.length} match(s)).`)
      return res.status(200).json({ ok: true, download: { filename: `planification_${ph.toLowerCase()}.csv`, content: csv, mime: 'text/csv' } })
    }

    await say('erreur', `Commande inconnue : « ${raw} ». Tapez "aide" pour la liste des commandes.`)
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[console_command]', err)
    await say('erreur', `Erreur inattendue : ${err.message}`)
    return res.status(200).json({ ok: true })
  }
}

// Calcule et enregistre une ronde de Phase 2 (système suisse par groupe). Une seule
// ronde à la fois — la ronde courante est celle définie dans l'onglet "Phase du
// tournoi" (TournamentState.currentRound), sauf surcharge explicite (recalculer ronde n).
async function computePhase2Round(req, res, answers, roundOverride) {
  const phase = 'PHASE2'
  const logEntries = []
  const log = (type, message) => logEntries.push({ phase, type, message })

  try {
    const [settings, state, dynamicMalusListP2] = await Promise.all([
      prisma.schedulingSettings.findUnique({ where: { phase } }),
      prisma.tournamentState.upsert({ where: { id: 1 }, update: {}, create: { id: 1, currentPhase: 'PHASE0', currentRound: null } }),
      loadMalusList(),
    ])
    if (!settings) {
      log('erreur', 'Aucun paramètre de planification configuré pour la Phase 2.')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Paramètres manquants.', logs: logEntries })
    }
    const round = roundOverride || state.currentRound
    if (!round) {
      log('erreur', 'Aucune ronde active. Définissez le numéro de ronde dans l\'onglet "Phase du tournoi" avant de calculer.')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Ronde non définie.', logs: logEntries })
    }

    const existingForRound = await prisma.plannedMatch.count({ where: { phase, roundNumber: round } })
    if (existingForRound > 0 && !answers.regenerate) {
      log('avertissement', `${existingForRound} match(s) déjà planifié(s) pour la ronde ${round}.`)
      log('question', 'Des matchs existent déjà pour cette ronde. Que faire ?')
      await flushLogs(phase, logEntries)
      return res.status(200).json({
        ok: false, needsInput: true,
        questions: [{ key: 'regenerate', question: `Des matchs sont déjà planifiés pour la ronde ${round}. Les régénérer ?`, options: [
          { value: 'yes', label: 'Supprimer et régénérer la ronde' },
          { value: 'no', label: 'Annuler' },
        ] }],
        logs: logEntries,
      })
    }
    if (answers.regenerate === 'no') {
      log('action', 'Calcul annulé par l\'administrateur.')
      await flushLogs(phase, logEntries)
      return res.status(200).json({ ok: false, aborted: true, logs: logEntries })
    }

    const groups = await prisma.phase2Group.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        members: {
          where: { user: { active: true, accepted: true, banned: false } },
          include: { user: { select: { id: true, firstName: true, lastName: true, username: true, category: true } } },
        },
      },
    })
    if (groups.length === 0) {
      log('erreur', 'Aucun groupe défini pour la Phase 2.')
      await flushLogs(phase, logEntries)
      return res.status(400).json({ ok: false, error: 'Aucun groupe.', logs: logEntries })
    }

    log('info', `Calcul de la ronde ${round} — cycle de ${settings.cycleLengthDays} jour(s), deadline ${settings.deadlineHoursBeforeCycleEnd}h avant la fin du cycle.`)

    const blackouts = await prisma.blackoutPeriod.findMany({ where: { phase } })
    let cursor = addDays(new Date(settings.periodStart), (round - 1) * settings.cycleLengthDays)
    const rawDate = new Date(cursor)
    cursor = shiftPastBlackouts(cursor, blackouts)
    if (cursor.getTime() !== rawDate.getTime()) log('avertissement', `Ronde ${round} initialement prévue le ${fmtDate(rawDate)} — décalée au ${fmtDate(cursor)} (période de non-jeu).`)
    else log('info', `Ronde ${round} : ${fmtDate(cursor)}.`)
    const scheduledDate = cursor
    const rawDeadlineAt = addHours(addDays(scheduledDate, settings.cycleLengthDays), -settings.deadlineHoursBeforeCycleEnd)
    const deadlineAt = extendDeadlineForBlackouts(scheduledDate, rawDeadlineAt, blackouts)

    if (deadlineAt > settings.periodEnd) {
      log('avertissement', `La deadline de cette ronde (${fmtDateTime(deadlineAt)}) dépasse la fin de période prévue (${fmtDate(settings.periodEnd)}).`)
      if (!answers.overrun) {
        log('question', 'Comment souhaitez-vous résoudre ce dépassement ?')
        await flushLogs(phase, logEntries)
        return res.status(200).json({
          ok: false, needsInput: true,
          questions: [{ key: 'overrun', question: 'La ronde dépasse la date de fin de période. Que faire ?', options: [
            { value: 'extend', label: `Étendre automatiquement la fin de période au ${fmtDate(deadlineAt)}` },
            { value: 'abort', label: 'Annuler' },
          ] }],
          logs: logEntries,
        })
      }
      if (answers.overrun === 'abort') {
        log('action', 'Calcul annulé par l\'administrateur.')
        await flushLogs(phase, logEntries)
        return res.status(200).json({ ok: false, aborted: true, logs: logEntries })
      }
      await prisma.schedulingSettings.update({ where: { phase }, data: { periodEnd: deadlineAt } })
      log('reponse', `Fin de période étendue au ${fmtDate(deadlineAt)}.`)
    }

    const toCreatePairs = []
    const byeMatchesToCreate = []
    const pendingQuestions = []
    const usersInfo = new Map()
    for (const g of groups) for (const m of g.members) usersInfo.set(m.user.id, m.user)

    for (const g of groups) {
      const members = g.members.map(m => m.user)
      if (members.length < 2) { log('avertissement', `Groupe « ${g.name} » : moins de 2 joueurs actifs — ignoré.`); continue }

      const matches = await prisma.match.findMany({ where: { phase, userId: { in: members.map(m => m.id) }, published: true }, include: { sets: true } })
      const byUser = new Map(members.map(m => [m.id, []]))
      for (const m of matches) byUser.get(m.userId)?.push(m)
      const ranked = sortPlayers(members.map(m => ({ ...m, ...computeStats(byUser.get(m.id) || []) })))
      const byId = new Map(ranked.map(p => [p.id, p]))
      let pool = ranked.map(p => p.id)

      // ── Bye si nombre impair ──
      if (pool.length % 2 !== 0) {
        const byeKey = `bye_${g.id}`
        const byeHistory = await prisma.match.findMany({ where: { phase, userId: { in: pool }, opponentFirstName: 'Exempt' } })
        const alreadyByed = new Set(byeHistory.map(m => m.userId))
        let byeUserId = [...pool].reverse().find(id => !alreadyByed.has(id))
        if (!byeUserId) byeUserId = pool[pool.length - 1]

        if (!answers[byeKey]) {
          const byePlayer = byId.get(byeUserId)
          pendingQuestions.push({
            key: byeKey,
            question: `Groupe « ${g.name} » : nombre impair de joueurs actifs — ${byePlayer.firstName} ${byePlayer.lastName} serait exempté cette ronde. Quelle convention appliquer ?`,
            options: [
              { value: 'gratuit', label: 'Point gratuit (comptabilisé comme une victoire)' },
              { value: 'nul', label: 'Comptabilisé comme une défaite (0 point)' },
              { value: 'ignorer', label: 'Aucun impact sur le classement' },
            ],
          })
          continue
        }
        const byePlayer = byId.get(byeUserId)
        pool = pool.filter(id => id !== byeUserId)
        if (answers[byeKey] !== 'ignorer') byeMatchesToCreate.push({ userId: byeUserId, playerName: `${byePlayer.firstName} ${byePlayer.lastName}`, groupName: g.name, convention: answers[byeKey] })
        log('info', `Groupe « ${g.name} » : ${byePlayer.firstName} ${byePlayer.lastName} exempté cette ronde (${answers[byeKey] === 'gratuit' ? 'point gratuit' : answers[byeKey] === 'nul' ? 'comptabilisé en défaite' : 'sans impact'}).`)
      }

      // ── Appariement sans rematch (glouton par proximité de classement, repli forcé si blocage) ──
      const playedKeys = await getExistingPairKeys(phase, members)
      const remaining = [...pool]
      const groupForced = []
      while (remaining.length > 0) {
        const a = remaining.shift()
        let idx = remaining.findIndex(b => !playedKeys.has([a, b].sort((x, y) => x - y).join('-')))
        let forced = false
        if (idx === -1) { idx = 0; forced = true }
        const b = remaining.splice(idx, 1)[0]
        if (forced) groupForced.push([a, b])
        toCreatePairs.push({ groupId: g.id, groupName: g.name, player1Id: a, player2Id: b, forced })
      }
      if (groupForced.length > 0) {
        log('avertissement', `Groupe « ${g.name} » : ${groupForced.length} paire(s) sans alternative — rematch inévitable pour ${groupForced.map(([a, b]) => `${byId.get(a).firstName} ${byId.get(a).lastName} vs ${byId.get(b).firstName} ${byId.get(b).lastName}`).join(', ')}.`)
      }
    }

    if (pendingQuestions.length > 0) {
      await flushLogs(phase, logEntries)
      return res.status(200).json({ ok: false, needsInput: true, questions: pendingQuestions, logs: logEntries })
    }

    const forcedPairs = toCreatePairs.filter(p => p.forced)
    if (forcedPairs.length > 0 && !answers.acceptForced) {
      log('question', 'Des rematchs forcés sont nécessaires. Confirmez-vous ?')
      await flushLogs(phase, logEntries)
      return res.status(200).json({
        ok: false, needsInput: true,
        questions: [{ key: 'acceptForced', question: `${forcedPairs.length} rematch(s) inévitable(s) (voir avertissements ci-dessus, aucune alternative sans rejouer un adversaire déjà rencontré). Comment procéder ?`, options: [
          { value: 'yes', label: 'Accepter ces rematchs et générer la ronde' },
          { value: 'no', label: 'Annuler — ajustement manuel des groupes/matchs' },
        ] }],
        logs: logEntries,
      })
    }
    if (answers.acceptForced === 'no') {
      log('action', 'Calcul annulé par l\'administrateur (rematchs forcés refusés).')
      await flushLogs(phase, logEntries)
      return res.status(200).json({ ok: false, aborted: true, logs: logEntries })
    }

    await prisma.plannedMatch.deleteMany({ where: { phase, roundNumber: round } })

    const toCreate = toCreatePairs.map(p => {
      const p1 = usersInfo.get(p.player1Id), p2 = usersInfo.get(p.player2Id)
      const auto = computeAutoMalus(p1.category, p2.category, dynamicMalusListP2)
      if (auto) log('info', `Malus automatique appliqué : ${p1.firstName} ${p1.lastName} vs ${p2.firstName} ${p2.lastName} (écart de classement ${p1.category}/${p2.category}).`)
      return { player1Id: p.player1Id, player2Id: p.player2Id, phase, roundNumber: round, scheduledDate, deadlineAt, malus: auto?.malus || null, malusTarget: auto?.malusTarget || null }
    })
    if (toCreate.length > 0) {
      await prisma.plannedMatch.createMany({ data: toCreate })

      // Appliquer les limites de concurrence des malus après la création groupée
      try {
        const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })
        if (state?.malusConfig) {
          const cfg = JSON.parse(state.malusConfig)
          if (Array.isArray(cfg)) {
            const r2 = await enforceMalusConcurrency(cfg)
            // BUG FIX : même correctif — messages dans logEntries.
            for (const lm of r2.logMessages) {
              if (lm.phase === phase) log(lm.type, lm.message)
              else await prisma.schedulingLog.create({ data: lm }).catch(() => {})
            }
            if (r2.reassigned > 0) log('info', `${r2.reassigned} match(s) réassigné(s) pour respecter les limites de malus (détail ci-dessus).`)
          }
        }
      } catch (e) {
        console.error('[computePhase2Round enforceMalusConcurrency]', e)
      }
    }

    for (const b of byeMatchesToCreate) {
      const win = b.convention === 'gratuit'
      await prisma.match.create({
        data: {
          userId: b.userId, phase, roundNumber: round, matchDate: scheduledDate,
          opponentFirstName: 'Exempt', opponentLastName: '(bye)',
          note: `Exemption automatique — ronde ${round}`, published: true,
          sets: { create: [{ setNumber: 1, playerScore: win ? 21 : 0, opponentScore: win ? 0 : 21 }] },
        },
      })
      log('action', `Match d'exemption créé pour ${b.playerName} (${b.groupName}), ronde ${round}.`)
    }

    await prisma.schedulingSettings.update({ where: { phase }, data: { locked: true } })
    log('action', `${toCreate.length} match(s) planifié(s) créé(s) pour la ronde ${round} de Phase 2. Paramètres verrouillés.`)

    await flushLogs(phase, logEntries)
    return res.status(201).json({ ok: true, count: toCreate.length, round, logs: logEntries })
  } catch (err) {
    console.error('[computePhase2Round]', err)
    log('erreur', `Erreur inattendue : ${err.message}`)
    await flushLogs(phase, logEntries).catch(() => {})
    return res.status(500).json({ ok: false, error: 'Erreur serveur.', logs: logEntries })
  }
}

/* ============================================================
 * BOTS — création / suppression / simulation de joueurs de test
 * ============================================================
 *
 * Principe général : pas de worker en arrière-plan (fonctions serverless).
 * Toutes les actions des bots sont matérialisées à l'avance sous forme de
 * BotTask (échéance réaliste, dueAt), et une seule "tick" — déclenchée à
 * chaque connexion admin (voir loadAllAdminDataWithProgress côté front) —
 * traite en une fois toutes les tâches arrivées à échéance. Les timestamps
 * enregistrés (LoginEvent.createdAt, Notification.readAt, Match.createdAt...)
 * restent ceux calculés pour dueAt, pas l'instant réel du tick, pour que
 * l'historique ait l'air naturel même traité en différé.
 */

const BOT_CONTACT_NATURES = [
  'Poser une question',
  'Signaler un bug sur le site',
  'Proposer une fonctionnalité sur le site',
  'Autre',
]

// Notes facultatives qu'un joueur pourrait laisser sur son match — un bot n'en
// met une que de temps en temps (comme un vrai joueur), et jamais si le match
// a déjà une note (ex: liée à un malus posé par l'admin, qu'on ne veut pas écraser).
const BOT_MATCH_NOTES = [
  'Match très serré, beaucoup de longs échanges.',
  "Bon match, merci à mon adversaire !",
  'Petit retard au début, sinon tout s\'est bien passé.',
  'Terrain un peu glissant aujourd\'hui.',
  'Revanche la prochaine fois 😄',
  'Match sympa, bonne ambiance.',
]

function randomExpMinutes(meanMinutes, maxMinutes) {
  const v = -Math.log(1 - Math.random()) * meanMinutes
  return Math.min(maxMinutes, Math.max(1, Math.round(v)))
}

// Simule un match au format de la charte : 3 sets gagnants de 11 points secs
// (sans point d'écart), premier à 3 sets manches gagné. Le niveau (catégorie)
// de chaque joueur influence probabilistiquement le score de chaque set.
function generateBotMatchSets(catBot, catOpp) {
  const sBot = CATEGORY_RANK[catBot] ?? 0
  const sOpp = CATEGORY_RANK[catOpp] ?? 0
  const diff = sBot - sOpp
  const botWinSetProb = 1 / (1 + Math.pow(10, -diff / 2))

  let botSetWins = 0, oppSetWins = 0, setNumber = 1
  const sets = []
  while (botSetWins < 3 && oppSetWins < 3 && setNumber <= 5) {
    const botWinsSet = Math.random() < botWinSetProb
    const gap = Math.min(6, Math.abs(diff))
    const loserScore = Math.max(0, Math.min(10, Math.round(Math.random() * (10 - gap * 0.8))))
    sets.push({
      setNumber,
      botScore: botWinsSet ? 11 : loserScore,
      oppScore: botWinsSet ? loserScore : 11,
    })
    if (botWinsSet) botSetWins++; else oppSetWins++
    setNumber++
  }
  return sets
}

/* ============================================================
 * ALERTES ADMIN — logs d'anomalies
 * ============================================================ */
async function handleAlerts(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      // Générer les alertes "score manquant" à la volée (matchs deadline dépassée sans score)
      const now = new Date()
      const overdueMatches = await prisma.plannedMatch.findMany({
        where: {
          forfeited: false,
          deadlineAt: { lt: now },
          notifiedAt: { not: null },
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true } },
        },
        orderBy: { deadlineAt: 'desc' },
        take: 50,
      })

      // Vérifier lesquels n'ont pas de match soumis
      const scoreMissingAlerts = []
      for (const pm of overdueMatches) {
        // BUG FIX : comparer prénom ET nom ET phase pour éviter faux négatifs.
        const hasScore = await prisma.match.findFirst({
          where: {
            specialMatchId: null,
            phase: pm.phase,
            OR: [
              { userId: pm.player1Id, opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName },
              { userId: pm.player2Id, opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName },
            ],
            matchDate: { gte: pm.scheduledDate || new Date(0), lte: pm.deadlineAt },
          },
        })
        if (!hasScore) {
          scoreMissingAlerts.push({
            type: 'score_missing',
            message: `Match #${pm.id} : ${pm.player1.firstName} ${pm.player1.lastName} vs ${pm.player2.firstName} ${pm.player2.lastName} — deadline dépassée le ${pm.deadlineAt.toLocaleDateString('fr-FR')} sans score saisi.`,
            meta: {
              plannedMatchId: pm.id,
              player1: { id: pm.player1Id, name: `${pm.player1.firstName} ${pm.player1.lastName}` },
              player2: { id: pm.player2Id, name: `${pm.player2.firstName} ${pm.player2.lastName}` },
              deadlineAt: pm.deadlineAt,
            },
            createdAt: pm.deadlineAt,
          })
        }
      }

      // Récupérer les alertes persistantes (login échoué, pseudo dupliqué)
      const stored = await prisma.adminAlert.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      })

      return res.status(200).json({ alerts: [...scoreMissingAlerts, ...stored] })
    } catch (err) {
      console.error('[admin/alerts GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method === 'POST') {
    const { action, alertId } = req.body || {}
    if (action === 'mark_read') {
      const aid = parseInt(alertId, 10)
      if (isNaN(aid)) return res.status(400).json({ error: 'alertId invalide.' })
      try {
        await prisma.adminAlert.update({ where: { id: aid }, data: { read: true } })
        return res.status(200).json({ ok: true })
      } catch (err) {
        return res.status(500).json({ error: 'Erreur serveur.' })
      }
    }
    if (action === 'mark_all_read') {
      try {
        await prisma.adminAlert.updateMany({ where: { type: { not: 'score_missing' } }, data: { read: true } })
        return res.status(200).json({ ok: true })
      } catch (err) {
        return res.status(500).json({ error: 'Erreur serveur.' })
      }
    }
    return res.status(400).json({ error: 'Action invalide.' })
  }

  return res.status(405).json({ error: 'Méthode non autorisée.' })
}

async function handleBots(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  if (req.method === 'GET') {
    try {
      const [count, pendingTasks] = await Promise.all([
        prisma.user.count({ where: { isBot: true } }),
        prisma.botTask.count({}),
      ])
      return res.status(200).json({ count, pendingTasks })
    } catch (err) {
      console.error('[admin/bots GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { action } = req.body || {}

  if (action === 'create') return createBots(req, res)
  if (action === 'delete_all') return deleteAllBots(req, res)
  if (action === 'tick') return tickBots(req, res)
  if (action === 'fast_forward') return fastForwardBots(req, res)

  return res.status(400).json({ error: 'Action invalide.' })
}

async function createBots(req, res) {
  let { count, perfectMode } = req.body || {}
  count = parseInt(count, 10)
  perfectMode = !!perfectMode
  if (isNaN(count) || count < 1 || count > 100) {
    return res.status(400).json({ error: 'Le nombre de bots doit être entre 1 et 100.' })
  }

  try {
    const existingBots = await prisma.user.findMany({ where: { isBot: true }, select: { username: true } })
    let maxN = 0
    for (const b of existingBots) {
      const m = b.username.match(/^bot_(\d+)$/)
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
    }

    // Mot de passe par défaut identique pour tous les bots ("petitbot") — hashé
    // une seule fois pour éviter de recalculer un Argon2 coûteux N fois.
    const passwordHash = await argon2.hash('petitbot', {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1,
    })

    let created = 0
    let migrationMissing = false
    for (let i = 1; i <= count; i++) {
      const n = maxN + i
      const category = VALID_CATEGORIES[Math.floor(Math.random() * VALID_CATEGORIES.length)]
      const baseData = {
        username: `bot_${n}`,
        passwordHash,
        firstName: 'Bot',
        lastName: String(n),
        phone: '0600000000',
        category,
        role: 'USER',
        accepted: true,
        banned: false,
        active: true,
        isBot: true,
      }
      let user
      try {
        user = await prisma.user.create({ data: { ...baseData, isPerfectBot: perfectMode } })
      } catch (createErr) {
        // Filet de sécurité : si la colonne isPerfectBot n'existe pas encore
        // en base (migration Prisma "npx prisma migrate dev" non appliquée
        // après l'ajout du champ), on ne bloque pas toute la création des
        // bots — on retente sans ce champ et on prévient l'admin dans le
        // message de retour plutôt que de renvoyer une erreur 500 muette.
        const msg = String(createErr?.message || '')
        const isMissingColumn = createErr?.code === 'P2022' || /isPerfectBot/i.test(msg)
        if (!isMissingColumn) throw createErr
        migrationMissing = true
        user = await prisma.user.create({ data: baseData })
      }
      created++
      // "Mode élève parfait" : ce bot ne se connecte jamais, ne lit pas de
      // notifications, ne consulte pas la FAQ et n'envoie pas de message de
      // contact — il ne fait QUE saisir ses scores de match, dès qu'un
      // match planifié le concerne (voir schedulePerfectBotScores(), appelé
      // à chaque tick). On ne programme donc PAS de tâche 'login' initiale
      // pour lui : c'est cette tâche qui, normalement, déclenche en cascade
      // toute l'activité "vie de joueur" (connexion, lecture FAQ, contact…).
      // Si la migration manque, le bot est créé en mode normal (impossible
      // de savoir qu'il devait être "parfait" sans la colonne) — cohérent
      // avec l'avertissement renvoyé ci-dessous.
      if (!perfectMode || migrationMissing) {
        await prisma.botTask.create({
          data: {
            botId: user.id,
            kind: 'login',
            dueAt: new Date(Date.now() + randomExpMinutes(90, 60 * 24) * 60000),
          },
        })
      }
    }

    const warning = migrationMissing
      ? ' ⚠️ La colonne "isPerfectBot" n\'existe pas encore en base (migration Prisma manquante) — les bots ont été créés en mode normal. Lancez `npx prisma migrate dev` puis redéployez pour activer le mode élève parfait.'
      : ''
    return res.status(201).json({
      ok: true, createdCount: created, migrationMissing,
      message: `${created} bot(s) créé(s)${perfectMode && !migrationMissing ? ' en mode élève parfait' : ''}.${warning}`,
    })
  } catch (err) {
    console.error('[bots create] FULL ERROR:', JSON.stringify({
      message: err?.message, code: err?.code, meta: err?.meta, name: err?.name,
    }, null, 2))
    console.error(err)
    // Panneau admin uniquement (déjà protégé par requireAdmin) : on renvoie
    // le détail réel de l'erreur plutôt qu'un message générique muet, pour
    // pouvoir diagnostiquer sans avoir besoin d'accéder aux logs serveur.
    return res.status(500).json({
      error: `Erreur serveur : ${err?.message || 'inconnue'}${err?.code ? ' (code ' + err.code + ')' : ''}`,
      code: err?.code || null,
      meta: err?.meta || null,
    })
  }
}

async function deleteAllBots(req, res) {
  try {
    const bots = await prisma.user.findMany({ where: { isBot: true }, select: { id: true } })
    const botIds = bots.map(b => b.id)
    if (botIds.length === 0) {
      return res.status(200).json({ ok: true, deletedCount: 0, message: 'Aucun bot à supprimer.' })
    }

    await prisma.$transaction(async (tx) => {
      // Détacher les matchs de vrais joueurs des rencontres spéciales impliquant
      // un bot, pour ne pas perdre leurs données (score, photos) à la suppression.
      const specials = await tx.specialMatch.findMany({
        where: { OR: [{ player1Id: { in: botIds } }, { player2Id: { in: botIds } }] },
        select: { id: true },
      })
      const specialIds = specials.map(s => s.id)
      if (specialIds.length > 0) {
        await tx.match.updateMany({
          where: { specialMatchId: { in: specialIds }, userId: { notIn: botIds } },
          data: { specialMatchId: null },
        })
        await tx.specialMatch.deleteMany({ where: { id: { in: specialIds } } })
      }

      // Les matchs planifiés impliquant un bot n'ont plus de sens sans leur
      // adversaire fictif — on les supprime (l'éventuel adversaire réel sera
      // notifié naturellement de la disparition du match la prochaine fois
      // qu'il consultera ses matchs planifiés).
      await tx.plannedMatch.deleteMany({
        where: { OR: [{ player1Id: { in: botIds } }, { player2Id: { in: botIds } }] },
      })

      // Corriger les compteurs FAQ AVANT de supprimer les bots. usefulCount/
      // notUsefulCount/viewCount sur FaqTopic sont des compteurs dénormalisés
      // incrémentés à chaque vote/vue ; la cascade Prisma supprime bien les
      // FaqVote des bots à la suppression des users, mais ne décrémente pas
      // ces compteurs, qui restaient donc gonflés indéfiniment (bug : "like/
      // dislike faussés"). On calcule ici la contribution des bots et on la
      // retire des compteurs, puis on purge leur historique de consultation
      // (FaqView) au lieu de le laisser orphelin (userId=null) — sinon
      // l'historique de consultation admin continuait d'afficher des visites
      // de comptes qui n'existent plus.
      const botVotes = await tx.faqVote.findMany({
        where: { userId: { in: botIds } },
        select: { topicId: true, useful: true },
      })
      const voteDelta = {}
      for (const v of botVotes) {
        if (!voteDelta[v.topicId]) voteDelta[v.topicId] = { useful: 0, notUseful: 0 }
        if (v.useful) voteDelta[v.topicId].useful++
        else voteDelta[v.topicId].notUseful++
      }
      for (const [topicId, d] of Object.entries(voteDelta)) {
        await tx.faqTopic.update({
          where: { id: parseInt(topicId, 10) },
          data: {
            usefulCount: { decrement: d.useful },
            notUsefulCount: { decrement: d.notUseful },
          },
        })
      }

      const botViews = await tx.faqView.findMany({
        where: { userId: { in: botIds } },
        select: { topicId: true, userId: true },
      })
      // viewCount n'est incrémenté qu'une fois par (topic, utilisateur) —
      // donc on ne décrémente qu'une fois par bot ayant consulté le sujet,
      // même s'il a généré plusieurs lignes FaqView pour ce sujet.
      const distinctViewersPerTopic = {}
      for (const fv of botViews) {
        if (!distinctViewersPerTopic[fv.topicId]) distinctViewersPerTopic[fv.topicId] = new Set()
        distinctViewersPerTopic[fv.topicId].add(fv.userId)
      }
      for (const [topicId, viewerSet] of Object.entries(distinctViewersPerTopic)) {
        await tx.faqTopic.update({
          where: { id: parseInt(topicId, 10) },
          data: { viewCount: { decrement: viewerSet.size } },
        })
      }
      await tx.faqView.deleteMany({ where: { userId: { in: botIds } } })

      // Filet de sécurité : si des compteurs étaient déjà faussés par des
      // suppressions de bots antérieures à ce correctif, on évite au moins
      // de les faire passer sous zéro.
      await tx.$executeRaw`UPDATE "FaqTopic" SET "viewCount" = GREATEST("viewCount", 0), "usefulCount" = GREATEST("usefulCount", 0), "notUsefulCount" = GREATEST("notUsefulCount", 0)`

      // Supprime les bots — cascade Prisma sur Match/MatchSet/MatchPhoto/
      // PouleMember/Phase2GroupMember/Notification/LoginEvent/ContactMessage/
      // FaqVote/BotTask.
      await tx.user.deleteMany({ where: { id: { in: botIds } } })

      // Nettoyage cosmétique des poules/groupes devenus vides.
      const emptyPoules = await tx.poule.findMany({ where: { members: { none: {} } }, select: { id: true } })
      if (emptyPoules.length > 0) await tx.poule.deleteMany({ where: { id: { in: emptyPoules.map(p => p.id) } } })
      const emptyGroups = await tx.phase2Group.findMany({ where: { members: { none: {} } }, select: { id: true } })
      if (emptyGroups.length > 0) await tx.phase2Group.deleteMany({ where: { id: { in: emptyGroups.map(g => g.id) } } })
    })

    return res.status(200).json({
      ok: true, deletedCount: botIds.length,
      message: `${botIds.length} bot(s) et toutes leurs données associées ont été supprimés.`,
    })
  } catch (err) {
    console.error('[bots delete_all]', err)
    return res.status(500).json({ error: 'Erreur serveur lors de la suppression des bots.' })
  }
}

// Traite toutes les tâches de bots dues, en plusieurs passes (une tâche
// traitée peut en programmer une autre déjà due, ex: lecture immédiate au
// login), puis programme la lecture des nouvelles notifs non lues des bots.
async function runBotTickLoop() {
  const now = new Date()
  let actionsDone = 0
  for (let pass = 0; pass < 5; pass++) {
    const dueTasks = await prisma.botTask.findMany({
      where: { dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      take: 300,
    })
    if (dueTasks.length === 0) break
    for (const task of dueTasks) {
      await processBotTask(task)
      actionsDone++
    }
  }
  await scheduleUnreadNotificationsForBots()
  await schedulePerfectBotScores()
  return actionsDone
}

async function tickBots(req, res) {
  try {
    const actionsDone = await runBotTickLoop()
    return res.status(200).json({ ok: true, actionsDone })
  } catch (err) {
    console.error('[bots tick]', err)
    return res.status(500).json({ error: 'Erreur serveur lors du tick des bots.' })
  }
}

// Fait "avancer le temps" pour les bots : recule l'échéance de TOUTES leurs
// tâches en attente de N heures, puis traite immédiatement tout ce qui devient
// dû. Pratique pour dérouler un cycle de test complet sans attendre de
// vraies heures/jours. N'affecte que les BotTask (aucune autre donnée du
// site n'est modifiée) — les timestamps enregistrés restent ceux, décalés,
// des tâches, donc l'historique reste cohérent (juste "plus tôt" que prévu).
async function fastForwardBots(req, res) {
  let { hours } = req.body || {}
  hours = parseFloat(hours)
  if (isNaN(hours) || hours <= 0 || hours > 720) {
    return res.status(400).json({ error: "Le nombre d'heures doit être entre 0 et 720 (30 jours)." })
  }
  try {
    await prisma.$executeRaw`UPDATE "BotTask" SET "dueAt" = "dueAt" - (${hours}::float * interval '1 hour')`
    const actionsDone = await runBotTickLoop()
    return res.status(200).json({ ok: true, actionsDone, hours })
  } catch (err) {
    console.error('[bots fast_forward]', err)
    return res.status(500).json({ error: "Erreur serveur lors de l'avance du temps." })
  }
}

async function processBotTask(task) {
  try {
    switch (task.kind) {
      case 'login':             await botDoLogin(task); break
      case 'logout':            await botDoLogout(task); break
      case 'read_notification': await botReadNotification(task); break
      case 'submit_score':      await botSubmitScore(task); break
      case 'faq_action':        await botFaqAction(task); break
      case 'contact_message':   await botContactMessage(task); break
    }
  } catch (err) {
    console.error('[bot task]', task.kind, task.id, err)
  } finally {
    await prisma.botTask.delete({ where: { id: task.id } }).catch(() => {})
  }
}

async function botDoLogin(task) {
  const bot = await prisma.user.findUnique({ where: { id: task.botId } })
  if (!bot || !bot.isBot) return

  const loginEvent = await prisma.loginEvent.create({
    data: {
      userId: bot.id,
      ip: null,
      userAgent: 'CDR-bot/1.0 (simulation)',
      success: true,
      message: 'Connexion simulée (bot de test)',
      createdAt: task.dueAt,
    },
  })

  // Session réaliste : 3 à 35 minutes.
  const sessionMinutes = 3 + Math.floor(Math.random() * 32)
  const logoutAt = new Date(task.dueAt.getTime() + sessionMinutes * 60000)
  await prisma.botTask.create({
    data: { botId: bot.id, kind: 'logout', dueAt: logoutAt, payload: { loginEventId: loginEvent.id } },
  })

  // Pendant la session : consultation FAQ (60%) et/ou message de contact (12%).
  if (Math.random() < 0.6) {
    const faqAt = new Date(task.dueAt.getTime() + Math.random() * sessionMinutes * 60000)
    await prisma.botTask.create({ data: { botId: bot.id, kind: 'faq_action', dueAt: faqAt } })
  }
  if (Math.random() < 0.12) {
    const contactAt = new Date(task.dueAt.getTime() + Math.random() * sessionMinutes * 60000)
    await prisma.botTask.create({ data: { botId: bot.id, kind: 'contact_message', dueAt: contactAt } })
  }

  // Prochaine connexion : tous les 1 à 6 jours, comme un joueur régulier.
  const nextLoginAt = new Date(logoutAt.getTime() + randomExpMinutes(60 * 24 * 1.5, 60 * 24 * 6) * 60000)
  await prisma.botTask.create({ data: { botId: bot.id, kind: 'login', dueAt: nextLoginAt } })
}

async function botDoLogout(task) {
  const loginEventId = task.payload?.loginEventId
  if (!loginEventId) return
  const reason = Math.random() < 0.85 ? 'manual' : 'inactivity'
  // On utilise task.dueAt comme heure de déconnexion fictive (cohérente avec la session planifiée),
  // ce qui donne une heure réaliste dans l'historique (ex: connexion 14h03 → déconnexion 14h27).
  await prisma.loginEvent.updateMany({
    where: { id: loginEventId, logoutAt: null },
    data: { logoutAt: task.dueAt, logoutReason: reason },
  })
}

async function botReadNotification(task) {
  const notificationId = task.payload?.notificationId
  if (!notificationId) return
  const notif = await prisma.notification.findUnique({ where: { id: notificationId } })
  if (!notif || notif.read) return

  await prisma.notification.update({ where: { id: notificationId }, data: { read: true, readAt: task.dueAt } })

  if (notif.type === 'next_match' && notif.plannedMatchId) {
    await scheduleBotSubmitScore(notif.plannedMatchId, task.botId, task.dueAt)
  }
}

// Programme la saisie de score d'un bot pour un match planifié, calibrée sur
// la deadline réelle du match : ~90% de chances de rentrer le score à temps,
// ~5% en retard (mais quand même saisi), ~5% oublié définitivement (le
// forfait automatique existant s'en charge alors, sans intervention du bot).
async function scheduleBotSubmitScore(plannedMatchId, botId, readAt) {
  const pm = await prisma.plannedMatch.findUnique({ where: { id: plannedMatchId } })
  if (!pm || pm.forfeited) return

  const existing = await prisma.botTask.findFirst({
    where: { botId, kind: 'submit_score', payload: { path: ['plannedMatchId'], equals: plannedMatchId } },
  })
  if (existing) return

  let dueAt
  const deadline = pm.deadlineAt
  if (deadline && deadline.getTime() > readAt.getTime()) {
    const windowMs = deadline.getTime() - readAt.getTime()
    const roll = Math.random()
    if (roll < 0.9) {
      const safetyMs = Math.min(10 * 60000, windowMs * 0.05)
      const frac = (Math.random() + Math.random()) / 2 // légèrement centré
      dueAt = new Date(readAt.getTime() + frac * (windowMs - safetyMs))
    } else if (roll < 0.95) {
      dueAt = new Date(deadline.getTime() + randomExpMinutes(240, 3 * 1440) * 60000)
    } else {
      return // oublie définitivement — forfait auto
    }
  } else {
    dueAt = new Date(readAt.getTime() + randomExpMinutes(180, 2880) * 60000)
  }

  await prisma.botTask.create({ data: { botId, kind: 'submit_score', dueAt, payload: { plannedMatchId } } })
}

async function botSubmitScore(task) {
  const plannedMatchId = task.payload?.plannedMatchId
  if (!plannedMatchId) return

  const pm = await prisma.plannedMatch.findUnique({
    where: { id: plannedMatchId },
    include: { player1: true, player2: true },
  })
  if (!pm || pm.forfeited) return // déjà forfaité ou converti entre-temps

  const bot = await prisma.user.findUnique({ where: { id: task.botId } })
  if (!bot) return

  const botIsPlayer1 = pm.player1Id === bot.id
  const opponent = botIsPlayer1 ? pm.player2 : pm.player1
  if (!opponent) return

  const rawSets = generateBotMatchSets(bot.category, opponent.category)
  const player1Sets = rawSets.map(s => ({
    setNumber: s.setNumber,
    playerScore: botIsPlayer1 ? s.botScore : s.oppScore,
    opponentScore: botIsPlayer1 ? s.oppScore : s.botScore,
  }))

  const matchDateObj = pm.scheduledDate || task.dueAt
  const roundInt = pm.phase === 'PHASE2' ? pm.roundNumber : null
  // Note facultative : ~25% de chance qu'un bot en laisse une, seulement si
  // le match planifié n'en a pas déjà une (ex: note liée à un malus admin,
  // qu'on ne veut jamais écraser).
  const noteStr = pm.note || (Math.random() < 0.25
    ? BOT_MATCH_NOTES[Math.floor(Math.random() * BOT_MATCH_NOTES.length)]
    : null)

  await prisma.$transaction([
    prisma.match.create({
      data: {
        userId: pm.player1Id, phase: pm.phase, roundNumber: roundInt,
        matchDate: matchDateObj, createdAt: task.dueAt,
        opponentFirstName: pm.player2.firstName, opponentLastName: pm.player2.lastName,
        note: noteStr, published: false,
        sets: { create: player1Sets },
      },
    }),
    prisma.match.create({
      data: {
        userId: pm.player2Id, phase: pm.phase, roundNumber: roundInt,
        matchDate: matchDateObj, createdAt: task.dueAt,
        opponentFirstName: pm.player1.firstName, opponentLastName: pm.player1.lastName,
        note: noteStr, published: false,
        sets: { create: player1Sets.map(s => ({ setNumber: s.setNumber, playerScore: s.opponentScore, opponentScore: s.playerScore })) },
      },
    }),
    prisma.plannedMatch.delete({ where: { id: pm.id } }),
  ])
}

async function botFaqAction(task) {
  const topics = await prisma.faqTopic.findMany({ select: { id: true } })
  if (topics.length === 0) return
  const topic = topics[Math.floor(Math.random() * topics.length)]

  const alreadyViewed = await prisma.faqView.findFirst({ where: { topicId: topic.id, userId: task.botId } })
  await prisma.faqView.create({ data: { topicId: topic.id, userId: task.botId, createdAt: task.dueAt } })
  if (!alreadyViewed) {
    await prisma.faqTopic.update({ where: { id: topic.id }, data: { viewCount: { increment: 1 } } })
  }

  if (Math.random() < 0.4) {
    const existingVote = await prisma.faqVote.findUnique({
      where: { topicId_userId: { topicId: topic.id, userId: task.botId } },
    })
    if (!existingVote) {
      const useful = Math.random() < 0.8
      await prisma.$transaction([
        prisma.faqVote.create({ data: { topicId: topic.id, userId: task.botId, useful, createdAt: task.dueAt } }),
        prisma.faqTopic.update({
          where: { id: topic.id },
          data: useful ? { usefulCount: { increment: 1 } } : { notUsefulCount: { increment: 1 } },
        }),
      ])
    }
  }
}

async function botContactMessage(task) {
  const bot = await prisma.user.findUnique({ where: { id: task.botId } })
  if (!bot) return
  const nature = BOT_CONTACT_NATURES[Math.floor(Math.random() * BOT_CONTACT_NATURES.length)]
  await prisma.contactMessage.create({
    data: {
      userId: bot.id,
      nature,
      subject: `[Test bot] ${nature}`,
      message: `Message généré automatiquement par ${bot.firstName} ${bot.lastName} (bot de test) pour vérifier le fonctionnement du formulaire de contact.`,
      createdAt: task.dueAt,
    },
  })
}

// Programme la lecture des notifications non lues des bots qui n'en ont pas
// déjà une de programmée (évite les doublons d'une tick à l'autre).
async function scheduleUnreadNotificationsForBots() {
  const unread = await prisma.notification.findMany({
    where: { read: false, user: { isBot: true } },
    select: { id: true, userId: true, createdAt: true },
  })
  if (unread.length === 0) return

  const pendingReadTasks = await prisma.botTask.findMany({
    where: { kind: 'read_notification' },
    select: { payload: true },
  })
  const alreadyScheduled = new Set(
    pendingReadTasks.map(t => t.payload?.notificationId).filter(Boolean)
  )

  const toCreate = []
  for (const n of unread) {
    if (alreadyScheduled.has(n.id)) continue
    const delayMinutes = randomExpMinutes(180, 4 * 1440) // moyenne 3h, plafond 4 jours
    const dueAt = new Date(n.createdAt.getTime() + delayMinutes * 60000)
    toCreate.push({ botId: n.userId, kind: 'read_notification', dueAt, payload: { notificationId: n.id } })
  }
  if (toCreate.length > 0) await prisma.botTask.createMany({ data: toCreate })
}

// "Mode élève parfait" : programme la saisie de score pour chaque match
// planifié impliquant un bot "élève parfait", sans passer par le cycle
// connexion → lecture de notification (ces bots ne se connectent jamais).
// Délai quasi nul (30s à 5min) et 0% de taux d'oubli — contrairement à
// scheduleBotSubmitScore() (bots normaux), il n'y a ici aucune chance de
// ne jamais programmer la tâche.
async function schedulePerfectBotScores() {
  let perfectBots
  try {
    perfectBots = await prisma.user.findMany({
      where: { isBot: true, isPerfectBot: true },
      select: { id: true },
    })
  } catch (err) {
    // Filet de sécurité : colonne isPerfectBot absente en base (migration
    // Prisma non appliquée) — on ignore silencieusement plutôt que de faire
    // échouer tout le tick des bots (qui tourne à chaque ouverture du
    // panneau admin).
    const msg = String(err?.message || '')
    if (err?.code === 'P2022' || /isPerfectBot/i.test(msg)) return
    throw err
  }
  if (perfectBots.length === 0) return
  const botIds = perfectBots.map(b => b.id)

  const matches = await prisma.plannedMatch.findMany({
    where: {
      forfeited: false,
      OR: [{ player1Id: { in: botIds } }, { player2Id: { in: botIds } }],
    },
    select: { id: true, player1Id: true, player2Id: true },
  })
  if (matches.length === 0) return

  const pendingScoreTasks = await prisma.botTask.findMany({
    where: { kind: 'submit_score', botId: { in: botIds } },
    select: { botId: true, payload: true },
  })
  const alreadyScheduled = new Set(
    pendingScoreTasks.map(t => `${t.botId}-${t.payload?.plannedMatchId}`)
  )

  const now = new Date()
  const toCreate = []
  for (const pm of matches) {
    for (const botId of [pm.player1Id, pm.player2Id]) {
      if (!botIds.includes(botId)) continue
      const key = `${botId}-${pm.id}`
      if (alreadyScheduled.has(key)) continue
      // Délai quasi nul : entre 30 secondes et 5 minutes.
      const dueAt = new Date(now.getTime() + (30 + Math.random() * 270) * 1000)
      toCreate.push({ botId, kind: 'submit_score', dueAt, payload: { plannedMatchId: pm.id } })
    }
  }
  if (toCreate.length > 0) await prisma.botTask.createMany({ data: toCreate })
}

/* ============================================================
   VITRINE — Gestion des médailles nominatives (CRUD)
   ?resource=medals
   GET  : liste toutes les médailles
   POST : action = create_medal | update_medal | delete_medal
   ============================================================ */
const VALID_RARITIES = ['Commune', 'Rare', 'Épique', 'Légendaire', 'Mythique']
const VALID_SHAPES = ['ronde', 'ecusson', 'bouclier', 'couronne', 'diamant', 'hexagone', 'trophee', 'insigne', 'sceau', 'etoile', 'pentagone', 'octogramme', 'fleche', 'croix', 'creneau', 'larme', 'medaillon', 'rune', 'etoile8', 'fer']
const VALID_ANIM_EFFECTS = ['flammes', 'ronces', 'etoiles', 'particules', 'aura', 'eclairs', 'etincelles', 'brillance']
const RARITY_ORDER = { 'Commune': 0, 'Rare': 1, 'Épique': 2, 'Légendaire': 3, 'Mythique': 4 }

/* Valide une année de saison. Accepte :
   - "" / null / undefined  -> médaille intemporelle (retourne '')
   - "AAAA-AAAI" où AAAI = AAAA + 1 (ex : "2026-2027")
   Retourne { ok, value, error } */
function validateSeasonYear(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: true, value: '' }
  const v = String(raw).trim()
  const m = v.match(/^(\d{4})-(\d{4})$/)
  if (!m) return { ok: false, error: 'Format d\'année de saison invalide. Attendu : AAAA-AAAI (ex : 2026-2027), ou vide pour une médaille intemporelle.' }
  const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
  if (a < 2000 || a > 2100) return { ok: false, error: 'Année de début hors plage (2000-2100).' }
  if (b !== a + 1) return { ok: false, error: 'L\'année de fin doit être l\'année suivante (ex : 2026-2027).' }
  return { ok: true, value: v }
}

/* Valide et normalise la config d'animation. Retourne une chaîne JSON ou null. */
function normalizeAnimations(animations) {
  if (!animations) return null
  let cfg = animations
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (_) { return null } }
  if (!cfg || typeof cfg !== 'object') return null
  let effects = Array.isArray(cfg.effects) ? cfg.effects.filter(e => VALID_ANIM_EFFECTS.includes(e)) : []
  if (!effects.length) return null
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, (typeof n === 'number' && !isNaN(n)) ? n : lo))
  return JSON.stringify({
    effects: effects.slice(0, 8),
    intensity: clamp(cfg.intensity, 0.1, 1),
    speed: clamp(cfg.speed, 0.2, 4),
    frequency: clamp(cfg.frequency, 0.1, 1),
  })
}

async function handleMedals(req, res) {
  const payload = requireAdmin(req, res)
  if (!payload) return

  // GET : liste toutes les médailles
  if (req.method === 'GET') {
    try {
      const medals = await prisma.medal.findMany({
        orderBy: [
          { seasonYear: 'desc' },
          { createdAt: 'desc' },
        ],
      })
      return res.status(200).json({ medals })
    } catch (err) {
      console.error('[admin/medals GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}
  if (!action) return res.status(400).json({ error: 'action requis.' })

  try {
    // ---- Création : un seul joueur ----
    if (action === 'create_medal') {
      const { symbol, color, shape, rarity, title, username, seasonYear, animations } = req.body || {}
      if (!symbol || !shape || !rarity || !title || !username) {
        return res.status(400).json({ error: 'Champs manquants : symbol, shape, rarity, title, username sont requis.' })
      }
      if (!VALID_SHAPES.includes(shape)) {
        return res.status(400).json({ error: 'Forme invalide.' })
      }
      if (!VALID_RARITIES.includes(rarity)) {
        return res.status(400).json({ error: 'Rareté invalide.' })
      }
      const yearCheck = validateSeasonYear(seasonYear)
      if (!yearCheck.ok) return res.status(400).json({ error: yearCheck.error })
      const animJson = normalizeAnimations(animations)
      const medal = await prisma.medal.create({
        data: {
          symbol: String(symbol).trim().slice(0, 10),
          color: String(color || '#FFD700').trim().slice(0, 20),
          shape,
          rarity,
          title: String(title).trim().slice(0, 200),
          username: String(username).trim().slice(0, 100),
          seasonYear: yearCheck.value,
          animations: animJson,
        },
      })
      // Push téléphone — seulement si l'onglet vitrine est visible
      ;(async () => {
        try {
          if (!await isTabVisible('vitrine')) return
          const targetUser = await prisma.user.findFirst({
            where: { username: { equals: String(username).trim(), mode: 'insensitive' } },
            select: { id: true },
          })
          if (targetUser) {
            await sendPushToUser(prisma, targetUser.id, {
              title: `${String(symbol).trim()} Nouvelle médaille !`,
              body: `Vous avez reçu la médaille "${String(title).trim()}" (${rarity}). Consultez votre vitrine.`,
              tab: 'vitrine',
            })
          }
        } catch {}
      })()
      return res.status(200).json({ ok: true, medal, message: 'Médaille créée.' })
    }

    // ---- Création : tous les joueurs actifs ----
    if (action === 'create_medal_all_active') {
      const { symbol, color, shape, rarity, title, seasonYear, animations } = req.body || {}
      if (!symbol || !shape || !rarity || !title) {
        return res.status(400).json({ error: 'Champs manquants : symbol, shape, rarity, title sont requis.' })
      }
      if (!VALID_SHAPES.includes(shape)) return res.status(400).json({ error: 'Forme invalide.' })
      if (!VALID_RARITIES.includes(rarity)) return res.status(400).json({ error: 'Rareté invalide.' })
      const yearCheck = validateSeasonYear(seasonYear)
      if (!yearCheck.ok) return res.status(400).json({ error: yearCheck.error })
      const animJson = normalizeAnimations(animations)
      // BUG FIX : le filtre active:true manquait — attribuait la médaille aux joueurs inactifs aussi.
      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, isBot: false, NOT: { username: { in: ['admin', 'root'] } } },
        select: { username: true },
      })
      const activeUsers = users.filter(u => u.username && !['admin', 'root'].includes(u.username.toLowerCase()))
      if (activeUsers.length === 0) {
        return res.status(400).json({ error: 'Aucun joueur actif trouvé pour attribuer la médaille.' })
      }
      const data = activeUsers.map(u => ({
        symbol: String(symbol).trim().slice(0, 10),
        color: String(color || '#FFD700').trim().slice(0, 20),
        shape,
        rarity,
        title: String(title).trim().slice(0, 200),
        username: String(u.username).trim().slice(0, 100),
        seasonYear: yearCheck.value,
        animations: animJson,
      }))
      const result = await prisma.medal.createMany({ data, skipDuplicates: false })
      // Push téléphone à chaque joueur — seulement si la vitrine est visible
      ;(async () => {
        try {
          if (!await isTabVisible('vitrine')) return
          const targetUsers = await prisma.user.findMany({
            where: { username: { in: activeUsers.map(u => u.username) } },
            select: { id: true },
          })
          await Promise.allSettled(
            targetUsers.map(u => sendPushToUser(prisma, u.id, {
              title: `${String(symbol).trim()} Nouvelle médaille !`,
              body: `Vous avez reçu la médaille "${String(title).trim()}" (${rarity}). Consultez votre vitrine.`,
              tab: 'vitrine',
            }))
          )
        } catch {}
      })()
      return res.status(200).json({ ok: true, created: result.count, message: result.count + ' médaille(s) créée(s) pour tous les joueurs actifs.' })
    }

    // ---- Modification ----
    if (action === 'update_medal') {
      const { id, symbol, color, shape, rarity, title, username, seasonYear, animations } = req.body || {}
      const medalId = parseInt(id, 10)
      if (isNaN(medalId)) return res.status(400).json({ error: 'id requis.' })
      if (shape && !VALID_SHAPES.includes(shape)) return res.status(400).json({ error: 'Forme invalide.' })
      if (rarity && !VALID_RARITIES.includes(rarity)) return res.status(400).json({ error: 'Rareté invalide.' })
      const data = {}
      if (symbol !== undefined) data.symbol = String(symbol).trim().slice(0, 10)
      if (color !== undefined) data.color = String(color || '#FFD700').trim().slice(0, 20)
      if (shape !== undefined) data.shape = shape
      if (rarity !== undefined) data.rarity = rarity
      if (title !== undefined) data.title = String(title).trim().slice(0, 200)
      if (username !== undefined) data.username = String(username).trim().slice(0, 100)
      if (seasonYear !== undefined) {
        const yearCheck = validateSeasonYear(seasonYear)
        if (!yearCheck.ok) return res.status(400).json({ error: yearCheck.error })
        data.seasonYear = yearCheck.value
      }
      if (animations !== undefined) data.animations = normalizeAnimations(animations)
      const medal = await prisma.medal.update({ where: { id: medalId }, data })
      return res.status(200).json({ ok: true, medal, message: 'Médaille mise à jour.' })
    }

    // ---- Suppression ----
    if (action === 'delete_medal') {
      const { id } = req.body || {}
      const medalId = parseInt(id, 10)
      if (isNaN(medalId)) return res.status(400).json({ error: 'id requis.' })
      await prisma.medal.delete({ where: { id: medalId } })
      return res.status(200).json({ ok: true, message: 'Médaille supprimée.' })
    }

    return res.status(400).json({ error: 'action inconnue pour les médailles.' })
  } catch (err) {
    console.error('[admin/medals POST]', err)
    if (err && err.code === 'P2025') {
      return res.status(404).json({ error: 'Médaille introuvable.' })
    }
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
