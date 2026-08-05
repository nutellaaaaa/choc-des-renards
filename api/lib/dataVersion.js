// lib/dataVersion.js
//
// Système de "corbeille" : avant toute suppression lourde, on capture un
// snapshot complet des lignes concernées (+ leurs relations dépendantes en
// cascade) dans DataVersion, puis on supprime. L'admin peut ensuite
// restaurer depuis l'onglet "Actions et autres" via restoreVersion().

const RETENTION_DAYS = 30

function expiresAtFromNow() {
  const d = new Date()
  d.setDate(d.getDate() + RETENTION_DAYS)
  return d
}

const TYPES_WITHOUT_IDS = new Set(['RESET_TOURNOI', 'FAQ_STATS'])

/**
 * Capture le snapshot complet d'un ensemble d'entités à supprimer, incluant
 * leurs relations dépendantes en cascade, PUIS crée l'entrée DataVersion.
 * Ne supprime rien elle-même : l'appelant doit effectuer la suppression
 * réelle juste après (idéalement dans la même transaction Prisma).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} entityType - 'POULE' | 'USER' | 'NOTIFICATION' | 'PLANNED_MATCH' | 'PHASE2_GROUP' | 'SPECIAL_MATCH' | 'RESET_TOURNOI'
 * @param {number[]} [ids] - identifiants des lignes principales à supprimer (non requis pour RESET_TOURNOI)
 * @param {string} [customLabel] - si fourni, utilisé à la place du label auto-généré
 * @returns {Promise<{ id: number, label: string } | null>}
 */
async function logDeletion(tx, entityType, ids, customLabel) {
  const needsIds = !TYPES_WITHOUT_IDS.has(entityType)
  if (needsIds && (!ids || ids.length === 0)) return null

  const { payload, label } = await captureSnapshot(tx, entityType, ids)
  if (!payload) return null

  const version = await tx.dataVersion.create({
    data: {
      label: customLabel || label,
      entityType,
      payload,
      expiresAt: expiresAtFromNow(),
    },
  })

  return { id: version.id, label: version.label }
}

/**
 * Construit le payload JSON pour un type d'entité donné, en résolvant les
 * relations dépendantes à capturer avant suppression.
 */
async function captureSnapshot(tx, entityType, ids) {
  switch (entityType) {
    case 'POULE': {
      const poules = await tx.poule.findMany({
        where: { id: { in: ids } },
        include: { members: true },
      })
      if (poules.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${poules.length} poule(s) : ${poules.map(p => p.name).join(', ')}`
      return { payload: { poules }, label }
    }

    case 'PHASE2_GROUP': {
      const groups = await tx.phase2Group.findMany({
        where: { id: { in: ids } },
        include: { members: true },
      })
      if (groups.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${groups.length} groupe(s) Phase 2 : ${groups.map(g => g.name).join(', ')}`
      return { payload: { groups }, label }
    }

    case 'USER': {
      const users = await tx.user.findMany({
        where: { id: { in: ids } },
        include: {
          matches: { include: { sets: true, photos: true } },
          pouleMembers: true,
          phase2Members: true,
          notifications: true,
          loginEvents: true,
          faqVotes: true,
          contactMessages: true,
          plannedMatches1: true,
          plannedMatches2: true,
          specialMatches1: true,
          specialMatches2: true,
        },
      })
      if (users.length === 0) return { payload: null, label: '' }
      const noms = users.map(u => `${u.firstName} ${u.lastName}`).join(', ')
      const label = `Suppression de ${users.length} joueur(s) : ${noms}`
      return { payload: { users }, label }
    }

    case 'NOTIFICATION': {
      const notifications = await tx.notification.findMany({ where: { id: { in: ids } } })
      if (notifications.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${notifications.length} notification(s)`
      return { payload: { notifications }, label }
    }

    case 'PLANNED_MATCH': {
      const plannedMatches = await tx.plannedMatch.findMany({
        where: { id: { in: ids } },
        include: {
          notifications: true,
          player1: { select: { firstName: true, lastName: true } },
          player2: { select: { firstName: true, lastName: true } },
        },
      })
      if (plannedMatches.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${plannedMatches.length} match(s) planifié(s)`
      return { payload: { plannedMatches }, label }
    }

    case 'SPECIAL_MATCH': {
      const specialMatches = await tx.specialMatch.findMany({
        where: { id: { in: ids } },
        include: { matches: { include: { sets: true, photos: true } } },
      })
      if (specialMatches.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${specialMatches.length} match(s) spécial(aux)`
      return { payload: { specialMatches }, label }
    }

    case 'MATCH': {
      const matches = await tx.match.findMany({
        where: { id: { in: ids } },
        include: { sets: true, photos: true },
      })
      if (matches.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${matches.length} match(s)`
      return { payload: { matches }, label }
    }

    case 'PHOTO': {
      const photos = await tx.matchPhoto.findMany({ where: { id: { in: ids } } })
      if (photos.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${photos.length} photo(s)`
      return { payload: { photos }, label }
    }

    case 'BLACKOUT': {
      const blackouts = await tx.blackoutPeriod.findMany({ where: { id: { in: ids } } })
      if (blackouts.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${blackouts.length} période(s) de non-jeu`
      return { payload: { blackouts }, label }
    }

    case 'FAQ_TOPIC': {
      const topics = await tx.faqTopic.findMany({
        where: { id: { in: ids } },
        include: { items: true, views: true, votes: true },
      })
      if (topics.length === 0) return { payload: null, label: '' }
      const label = `Suppression de ${topics.length} sujet(s) FAQ : ${topics.map(t => t.question).join(', ')}`
      return { payload: { topics }, label }
    }

    case 'FAQ_STATS': {
      // Reset global des stats FAQ : capture TOUS les votes/vues de TOUS les
      // sujets, ainsi que les compteurs dénormalisés de chaque FaqTopic
      // (remis à zéro par l'action), pour une restauration fidèle.
      const [votes, views, topicCounters] = await Promise.all([
        tx.faqVote.findMany(),
        tx.faqView.findMany(),
        tx.faqTopic.findMany({ select: { id: true, viewCount: true, usefulCount: true, notUsefulCount: true } }),
      ])
      const total = votes.length + views.length
      if (total === 0) return { payload: null, label: '' }
      const label = `Réinitialisation des stats FAQ : ${votes.length} vote(s), ${views.length} vue(s)`
      return { payload: { votes, views, topicCounters }, label }
    }

    case 'RESET_TOURNOI': {
      const [matches, poules, groups, specialMatches, plannedMatches] = await Promise.all([
        tx.match.findMany({ include: { sets: true, photos: true } }),
        tx.poule.findMany({ include: { members: true } }),
        tx.phase2Group.findMany({ include: { members: true } }),
        tx.specialMatch.findMany(),
        tx.plannedMatch.findMany({ include: { notifications: true } }),
      ])
      const total = matches.length + poules.length + groups.length + specialMatches.length + plannedMatches.length
      if (total === 0) return { payload: null, label: '' }
      const label = `Réinitialisation du tournoi : ${matches.length} match(s), ${poules.length} poule(s), ${groups.length} groupe(s), ${specialMatches.length} match(s) spécial(aux), ${plannedMatches.length} match(s) planifié(s)`
      return { payload: { matches, poules, groups, specialMatches, plannedMatches }, label }
    }

    default:
      throw new Error(`[dataVersion] entityType inconnu : ${entityType}`)
  }
}

/**
 * Restaure une DataVersion : réinsère toutes les lignes capturées dans le
 * snapshot, en respectant l'ordre des dépendances. Les lignes qui ne
 * peuvent pas être recréées (conflit d'ID, relation vers une entité qui
 * n'existe plus) sont ignorées avec un avertissement plutôt que de faire
 * échouer toute la restauration.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} versionId
 * @returns {Promise<{ label: string, warnings: string[] }>}
 */
async function restoreVersion(tx, versionId) {
  const version = await tx.dataVersion.findUnique({ where: { id: versionId } })
  if (!version) throw new Error('Version introuvable.')
  if (version.restoredAt) throw new Error('Cette version a déjà été restaurée.')
  if (version.expiresAt < new Date()) throw new Error('Cette version a expiré.')

  const warnings = []
  const tryCreate = async (label, fn) => {
    try {
      await fn()
    } catch (err) {
      warnings.push(`${label} : ${err.message}`)
    }
  }

  const payload = version.payload

  switch (version.entityType) {
    case 'POULE': {
      for (const p of payload.poules) {
        const { members, ...pFields } = p
        await tryCreate(`Poule "${p.name}"`, () => tx.poule.create({ data: pFields }))
        for (const m of members)
          await tryCreate(`Membre de poule #${m.id}`, () => tx.pouleMember.create({ data: m }))
      }
      break
    }

    case 'PHASE2_GROUP': {
      for (const g of payload.groups) {
        const { members, ...gFields } = g
        await tryCreate(`Groupe "${g.name}"`, () => tx.phase2Group.create({ data: gFields }))
        for (const m of members)
          await tryCreate(`Membre de groupe #${m.id}`, () => tx.phase2GroupMember.create({ data: m }))
      }
      break
    }

    case 'USER': {
      for (const u of payload.users) {
        const { matches, pouleMembers, phase2Members, notifications, loginEvents,
                faqVotes, contactMessages, plannedMatches1, plannedMatches2,
                specialMatches1, specialMatches2, ...userFields } = u
        await tryCreate(`Joueur "${u.firstName} ${u.lastName}"`, () => tx.user.create({ data: userFields }))
        for (const m of pouleMembers || [])
          await tryCreate(`Membre de poule #${m.id}`, () => tx.pouleMember.create({ data: m }))
        for (const m of phase2Members || [])
          await tryCreate(`Membre de groupe #${m.id}`, () => tx.phase2GroupMember.create({ data: m }))
        for (const le of loginEvents || [])
          await tryCreate(`Connexion #${le.id}`, () => tx.loginEvent.create({ data: le }))
        for (const fv of faqVotes || [])
          await tryCreate(`Vote FAQ #${fv.id}`, () => tx.faqVote.create({ data: fv }))
        for (const cm of contactMessages || [])
          await tryCreate(`Message de contact #${cm.id}`, () => tx.contactMessage.create({ data: cm }))
        const specialMatchesDedup = [...(specialMatches1 || []), ...(specialMatches2 || [])]
          .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
        for (const sm of specialMatchesDedup)
          await tryCreate(`Match spécial #${sm.id}`, () => tx.specialMatch.create({ data: sm }))
        const plannedMatchesDedup = [...(plannedMatches1 || []), ...(plannedMatches2 || [])]
          .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
        for (const pm of plannedMatchesDedup)
          await tryCreate(`Match planifié #${pm.id}`, () => tx.plannedMatch.create({ data: pm }))
        for (const m of matches || []) {
          const { sets, photos, ...matchFields } = m
          await tryCreate(`Match #${m.id}`, () => tx.match.create({ data: matchFields }))
          for (const s of sets || [])
            await tryCreate(`Set #${s.id}`, () => tx.matchSet.create({ data: s }))
          for (const ph of photos || [])
            await tryCreate(`Photo #${ph.id}`, () => tx.matchPhoto.create({ data: ph }))
        }
        for (const n of notifications || [])
          await tryCreate(`Notification #${n.id}`, () => tx.notification.create({ data: n }))
      }
      break
    }

    case 'NOTIFICATION': {
      for (const n of payload.notifications)
        await tryCreate(`Notification #${n.id}`, () => tx.notification.create({ data: n }))
      break
    }

    case 'PLANNED_MATCH': {
      for (const pm of payload.plannedMatches) {
        const { notifications, player1, player2, ...pmFields } = pm
        await tryCreate(`Match planifié #${pm.id}`, () => tx.plannedMatch.create({ data: pmFields }))
        for (const n of notifications || [])
          await tryCreate(`Notification #${n.id}`, () => tx.notification.create({ data: n }))
      }
      break
    }

    case 'SPECIAL_MATCH': {
      for (const sm of payload.specialMatches) {
        const { matches, ...smFields } = sm
        await tryCreate(`Match spécial #${sm.id}`, () => tx.specialMatch.create({ data: smFields }))
        for (const m of matches || []) {
          const { sets, photos, ...matchFields } = m
          await tryCreate(`Match #${m.id}`, () => tx.match.create({ data: matchFields }))
          for (const s of sets || [])
            await tryCreate(`Set #${s.id}`, () => tx.matchSet.create({ data: s }))
          for (const ph of photos || [])
            await tryCreate(`Photo #${ph.id}`, () => tx.matchPhoto.create({ data: ph }))
        }
      }
      break
    }

    case 'MATCH': {
      for (const m of payload.matches) {
        const { sets, photos, ...matchFields } = m
        await tryCreate(`Match #${m.id}`, () => tx.match.create({ data: matchFields }))
        for (const s of sets || [])
          await tryCreate(`Set #${s.id}`, () => tx.matchSet.create({ data: s }))
        for (const ph of photos || [])
          await tryCreate(`Photo #${ph.id}`, () => tx.matchPhoto.create({ data: ph }))
      }
      break
    }

    case 'PHOTO': {
      for (const ph of payload.photos)
        await tryCreate(`Photo #${ph.id}`, () => tx.matchPhoto.create({ data: ph }))
      break
    }

    case 'BLACKOUT': {
      for (const b of payload.blackouts)
        await tryCreate(`Période de non-jeu #${b.id}`, () => tx.blackoutPeriod.create({ data: b }))
      break
    }

    case 'FAQ_TOPIC': {
      for (const t of payload.topics) {
        const { items, views, votes, ...topicFields } = t
        await tryCreate(`Sujet FAQ "${t.question}"`, () => tx.faqTopic.create({ data: topicFields }))
        for (const it of items || [])
          await tryCreate(`Item FAQ #${it.id}`, () => tx.faqItem.create({ data: it }))
        for (const v of views || [])
          await tryCreate(`Vue FAQ #${v.id}`, () => tx.faqView.create({ data: v }))
        for (const v of votes || [])
          await tryCreate(`Vote FAQ #${v.id}`, () => tx.faqVote.create({ data: v }))
      }
      break
    }

    case 'FAQ_STATS': {
      const { votes, views, topicCounters } = payload
      for (const v of votes)
        await tryCreate(`Vote FAQ #${v.id}`, () => tx.faqVote.create({ data: v }))
      for (const v of views)
        await tryCreate(`Vue FAQ #${v.id}`, () => tx.faqView.create({ data: v }))
      for (const tc of topicCounters)
        await tryCreate(`Compteurs sujet FAQ #${tc.id}`, () => tx.faqTopic.update({
          where: { id: tc.id },
          data: { viewCount: tc.viewCount, usefulCount: tc.usefulCount, notUsefulCount: tc.notUsefulCount },
        }))
      break
    }

    case 'RESET_TOURNOI': {
      const { matches, poules, groups, specialMatches, plannedMatches } = payload

      for (const sm of specialMatches)
        await tryCreate(`Match spécial #${sm.id}`, () => tx.specialMatch.create({ data: sm }))

      for (const p of poules) {
        const { members, ...pFields } = p
        await tryCreate(`Poule "${p.name}"`, () => tx.poule.create({ data: pFields }))
        for (const m of members)
          await tryCreate(`Membre de poule #${m.id}`, () => tx.pouleMember.create({ data: m }))
      }

      for (const g of groups) {
        const { members, ...gFields } = g
        await tryCreate(`Groupe "${g.name}"`, () => tx.phase2Group.create({ data: gFields }))
        for (const m of members)
          await tryCreate(`Membre de groupe #${m.id}`, () => tx.phase2GroupMember.create({ data: m }))
      }

      for (const pm of plannedMatches) {
        const { notifications, ...pmFields } = pm
        await tryCreate(`Match planifié #${pm.id}`, () => tx.plannedMatch.create({ data: pmFields }))
        for (const n of notifications || [])
          await tryCreate(`Notification #${n.id}`, () => tx.notification.create({ data: n }))
      }

      for (const m of matches) {
        const { sets, photos, ...matchFields } = m
        await tryCreate(`Match #${m.id}`, () => tx.match.create({ data: matchFields }))
        for (const s of sets || [])
          await tryCreate(`Set #${s.id}`, () => tx.matchSet.create({ data: s }))
        for (const ph of photos || [])
          await tryCreate(`Photo #${ph.id}`, () => tx.matchPhoto.create({ data: ph }))
      }
      break
    }

    default:
      throw new Error(`[dataVersion] Restauration non implémentée pour ${version.entityType}`)
  }

  await tx.dataVersion.update({ where: { id: versionId }, data: { restoredAt: new Date() } })

  return { label: version.label, warnings }
}

module.exports = { logDeletion, captureSnapshot, restoreVersion, RETENTION_DAYS }
