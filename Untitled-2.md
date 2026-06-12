Sur mon site, fais les modifications et les ajouts de fonctionnalités suivantes : - Dans l'onglet "publication match", "en attente", l'admin renseigne le score pour les deux joueurs. C'est à dire qu'on ne lui propose pas de renseigner le score joueur 1 ou le score joueur 2 mais juste "renseigner le score" et l'adversaire n'est pas à choisir parmi la liste des utilisateurs, c'est l'adversaire du match et ça ne peut être autrement.  - Les matchs en attente de publication (qui n'ont donc pas encore été joués) peuvent être modifiés (malus, date) ou supprimé.  - Corriges les problèmes d'alignement de la section "Charte" (situés dans les différents articles de la charte) - Revoir ce qui est mis en gras dans la Charte (exemple pour l'article 3, on met en gras "le dernier samedi" car c'est la date qui est importante) - Historique des demandes de connexion refusées par l'admin (comme affichage pour sa propre satisfaction, sans plus d'intérêt particulier) - Dans l'affichage des Sets, remplacer les +X par X (ex, +3 devient 3) - Les matchs fait par chaque joueurs dans le classement général doit toujours être affiché en Live, c'est le calcul du classement qui doit être actualisé par l'admin. Par exemple, si je viens de faire un match, mon match devient visible par les autres utilisateurs lorsqu'il est publié par l'admin, mes points me sont attribués, mais je ne bouge pas dans le classement avant que le classement ne soit défigé. Ca évite les problèmes lors de la phase de ronde suisse par exemple.  - Dans les logs de connexions de la section "Connexions" auquelle a accès l'admin, ajoute l'heure de déconnexion à l'heure de connexion des joueurs. Si un joueur s'est déconnecté manuellement, l'heure de déconnexion est celle indiquée. Si le joueur a été déconnecté par inactivité, retires 15 minutes à l'heure pour avoir la vraie heure à laquelle il a arrêté d'utiliser le site.  - Lorsque l'admin ajoute un match à des joueurs, il a la possibilité de mettre une note optionnelle. Je voudrai qu'il ait également la possibilité de rajouter une/plusieurs photos. Elles seront alors visibles par tous dans le classement, en cliquant sur un joueur, dans le match en question de l'historique des matchs joués de ce joueur. Il sera possible de cliquer sur ces images pour les ouvrir en grand.  - Avoir la possibilité d'envoyer une notification à plusieurs joueurs en même temps (petites cases à cocher + case "tout le monde") - Toutes les photos sont stockées dans la base de donnée et sont consultables publiquement dans un onglet "souvenirs" à côté de l'onglet "classement" (en plus dêtre présentes dans l'historique des matchs des joueurs) - Possibilité de rajouter des malus à certains joueurs, menu déroulant présent dans "rencontre" ou dans "publication des matchs". Concrètement, l'admin ira dans les matchs à venir, et aura un menu déroulant pour ajouter un malus parmis :  ♡ Interdiction de smasher ou de tendre droit ♡ Porter un cache-œil ♡ Interdiction de taper le volant au dessus de la bande ♡ Jouer en demi-terrain pour le joueur le moins bien class´e (le demi-terrain change selon le service en cours) ♡ Jouer avec une raquette courte ♡ Jouer avec une raquette lest´ee ♡ Jouer avec une raquette de pr´ecision ♡ Jouer avec un bras dans le dos constamment ♡ Interdiction de faire un coup droit ♡ Interdiction de faire un revers ♡ Annoncer chaque coup a voix haute avant de le jouer ♡ Les couloirs font partie du terrain du joueur le plus class´e ♡ Les points du joueur le moins class´e comptent double ♡ Le point est marqu´e par le joueur le mieux class´e uniquement s’il touche le sol avant la raquette de l’adversaire ♡ Le point est marqu´e par le joueur le moins class´e ♡ Le joueur le mieux class´e marque si le volant touche le sol uniquement dans une zone donn´ee ; la zone change a set : riviere, box, couloir du fond, box puis riviere Par défaut, le malus est none.         Poses moi toutes les questions dont tu as besoin

Afficher moins
13:02

Inventorié dix modifications majeures et formulated huit questions critiques
Inventorié dix modifications majeures et formulated huit questions critiques
This is a very large feature request. Let me analyze each item and identify what I need to know before implementing:

Publication match / score entry for special matches - Instead of showing "Saisir scores joueur 1" / "Saisir scores joueur 2", just show one button "Renseigner le score" that opens a modal where the admin enters both players' scores, and the opponent is pre-filled (not selectable).
Pending matches can be modified (malus, date) or deleted - Wait, "matchs en attente de publication (qui n'ont donc pas encore été joués)" - these are matches that haven't been played yet. But in the current system, matches in the "pending" list are unpublished matches (already played but not yet published). The user seems to be describing a different concept - matches that are "scheduled" but not yet played. This is a new concept - "matchs à venir" vs "matchs joués en attente de publication". I need clarification.
Charte alignment fixes - Need to see the charte section in index.html
Charte bold fixes - Need to see the charte content
History of refused connection requests - Showing login events where the admin refused a user's registration? Or login attempts that were rejected? I need clarification - "demandes de connexion refusées par l'admin" - this could mean:
Registration requests that the admin refused (action 'refuse')
Login attempts that were rejected (wrong password, etc.) I think it means when admin clicks "Refuser" on a pending registration.
Replace +X by X in sets display - Simple frontend fix
Match history always live, only ranking frozen - Currently, matches become visible when published. The user wants: matches are always visible to all users once published, but the RANKING calculation is what gets frozen. So matches appear immediately in player history but ranking position doesn't change until admin unfreezes. This is a significant architectural change.
…
Afficher moins
Terminé
Avant de commencer, j'ai besoin de clarifications sur plusieurs points bloquants :

1. "Matchs en attente non encore joués" Dans le système actuel, la liste "en attente" = matchs joués mais non publiés. Tu sembles décrire une nouvelle catégorie : des matchs planifiés (à venir, pas encore joués). Est-ce bien un nouveau modèle distinct, ou tu veux juste pouvoir modifier la date/malus des matchs déjà saisis avant de les publier ?

2. Photos — stockage Neon/PostgreSQL peut stocker des images en base mais c'est très déconseillé (lent, coûteux en espace). Sur le plan Hobby Vercel tu n'as pas de stockage de fichiers natif. Tu as déjà un service externe (Cloudinary, Supabase Storage, Cloudflare R2...) ? Sinon, je propose Cloudinary free tier (25 Go gratuit, upload direct depuis le navigateur). Tu valides ?

3. Déconnexion On a supprimé /api/logout dans la session précédente. Pour logger l'heure de déconnexion manuelle il faut le rétablir. Pour la déconnexion par inactivité (−15 min), je peux estimer à partir du dernier loginEvent + 15 min, sans tracking réel. Tu confirmes cette approche ?

4. Malus — sur quel objet ? Le malus s'applique à une rencontre spéciale (SpecialMatch) ou à un Match déjà saisi ? Et si un match a deux joueurs avec des malus différents, chaque joueur a le sien, ou c'est un malus global sur le match ?

5. Classement figé vs live Tu veux que les matchs publiés soient toujours visibles dans la fiche de chaque joueur (live), mais que la position dans le classement général reste gelée jusqu'à l'action admin. Dans la fiche individuelle d'un joueur, ses stats (V/D/points) sont-elles aussi gelées ou toujours live ?

6. "Demandes de connexion refusées" Tu veux voir les inscriptions que l'admin a refusées (action refuse) ou les tentatives de login échouées (mauvais mot de passe, compte banni...) ? Les deux sont déjà dans les loginEvent, je veux juste savoir comment filtrer l'affichage.

Oui, c'est un modèle distinct, excellente remarque. Crée une nouvelle section "matchs à venir", ou "matchs planifiés". 2. Seulement si c'est gratuit. Si c'est trop dur à mettre en place on verra ça dans un second temps. 3. Non, je veux l'heure exacte (temps exact si déconnexion manuelle ou temps -15 min si déconnexion par inactivité). 4. Le malus ne portera que sur un joueur, et pourra être ajouté sur un match présent dans la section "matchs planifiés". 5. Oui, du coup ses stats sont en live, mais le classement est figé jusqu'à ce que l'admin dégèle. 6. Je veux l'historique des joueurs qui ont fait une demande d'inscription et qui ont été refusés
13:09

Orchestrated implementation strategy for planned matches, photos, and logout tracking
Orchestrated implementation strategy for planned matches, photos, and logout tracking
Let me ask a few more clarifying questions before diving into implementation, since some of these are still unclear.

For point 3 (déconnexion), the user wants exact logout time. But since we removed /api/logout, we need to:

Re-add /api/logout to log manual disconnections
For inactivity timeout (15 min), the frontend already has a 15-min timer that calls logout() - so when that fires, it should call /api/logout with a flag saying "inactivity"
Then the display in admin shows: manual logout time = exact time logged; inactivity logout = logged time - 15 min (because the inactivity timer fires 15 min after last activity)
Wait, actually re-reading: "Si le joueur a été déconnecté par inactivité, retires 15 minutes à l'heure pour avoir la vraie heure à laquelle il a arrêté d'utiliser le site." - This means: when inactivity disconnects at time T, last real activity was at T-15min. So we log T (the actual logout time) and display T-15min.

Actually the simpler approach: when logout happens due to inactivity, log it with a flag reason: 'inactivity', and when displaying, subtract 15 min from the timestamp for those events.

For point 2 (photos), Cloudinary free tier works. The approach:

Upload from browser directly to Cloudinary (unsigned upload preset)
Store the URL in the database
Need a new model MatchPhoto with matchId, url, publicId
Also a Memory model or just use MatchPhoto for the "Souvenirs" tab
This requires adding to the schema and creating a new API endpoint. But since we're at 10 functions already (after the previous session's merges), we have room for 2 more.

For point 1 (Matchs planifiés), need:

New model PlannedMatch with player1Id, player2Id, scheduledDate, malus (enum or string), note
API endpoint to CRUD planned matches
Frontend section
For malus, it's on a PlannedMatch, one malus per player in the match. Wait, "Le malus ne portera que sur un joueur" - so it's on a specific player, not the match itself. …

Afficher moins
Terminé
Encore quelques points avant de coder :

7. Photos Cloudinary est gratuit (25 Go). Ça nécessite que tu crées un compte sur cloudinary.com et que tu me donnes un upload preset (non signé). Tu veux le faire maintenant, ou on reporte les photos à une prochaine session ?

8. Matchs planifiés → conversion en match réel Quand l'admin saisit le score d'un match planifié, est-ce qu'il doit convertir le match planifié en match réel (qui passe alors en attente de publication), ou les deux coexistent indépendamment (le match planifié reste jusqu'à suppression manuelle) ?

9. Notifications groupées "Tout le monde" = tous les joueurs avec accepted: true et banned: false ? Les joueurs inactifs (active: false) sont inclus ou exclus ?

10. Charte Pour les problèmes d'alignement et de mise en gras, tu peux me copier ici le texte exact de 2-3 articles qui posent problème, avec ce qui doit être en gras ? Je vois l'HTML dans tes fichiers mais c'est plus rapide si tu m'indiques directement les passages concernés plutôt que je les devine.

11. Déconnexion manuelle — /api/logout On a 10 fonctions serverless actuellement, la limite est 12. Si je rajoute /api/logout + /api/admin/planned (matchs planifiés), on est exactement à 12. Ça te va, ou tu veux que je fusionne davantage ?

12. Demandes d'inscription refusées Ces refus sont loggés dans loginEvent avec message: 'Demande refusée, compte supprimé' (action refuse dans action.js). Mais le problème : quand on refuse, on supprime l'utilisateur (prisma.user.delete), donc il n'y a plus de userId valide dans le log. Tu veux que je logue le nom/prénom de la personne refusée dans le message du loginEvent avant la suppression, pour qu'il reste une trace consultable ?


Je vais lire les fichiers pour bien comprendre la structure avant de coder.Ran 11 commands, viewed a fileRan 11 commands, viewed a fileCheck index.html sizebashwc -l /mnt/user-data/uploads/index.htmlOutput2200 /mnt/user-data/uploads/index.html
Find charte sectionbashgrep -n "charte\|Charte\|article\|Article" /mnt/user-data/uploads/index.html | head -60Output74:  .article { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.75rem 2rem; margin-bottom: 1.25rem; transition: border-color 0.2s; }
75:  .article:hover { border-color: var(--orange); }
76:  .article-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; cursor: pointer; }
77:  .article-num { font-family: var(--font-display); font-size: 1.8rem; color: var(--orange); min-width: 48px; }
78:  .article-title { font-family: var(--font-heading); font-size: 1.15rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; flex: 1; }
79:  .article-chevron { color: var(--gray); transition: transform 0.25s; font-size: 1.2rem; }
80:  .article.open .article-chevron { transform: rotate(180deg); }
81:  .article-body { overflow: hidden; max-height: 0; transition: max-height .4s ease; display: block; }
82:  .article.open .article-body { max-height: 1600px; }
83:  .article-body p { color: var(--gray-light); line-height: 1.75; margin-bottom: 0.75rem; font-size: 0.97rem; }
84:  .article-body ul { padding-left: 0; list-style: none; }
85:  .article-body ul li { display: flex; gap: 0.75rem; align-items: flex-start; color: var(--gray-light); font-size: 0.95rem; padding: 0.5rem 0; border-bottom: 1px solid var(--dark4); line-height: 1.6; }
86:  .article-body ul li:last-child { border-bottom: none; }
87:  .article-body ul li::before { content: '♦'; color: var(--orange); font-size: 0.65rem; margin-top: 0.5rem; flex-shrink: 0; }
811:    <button class="nav-btn" onclick="showPage('reglement',this)">Charte</button>
840:    <p class="section-subtitle">Charte officielle du Choc des Renards &mdash; Club de Bondy</p>
842:      <div class="reglement-tools-text"><strong>Version PDF disponible</strong><br>Téléchargez la charte complète du Choc des Renards au format PDF.</div>
846:    <div class="article open" onclick="toggleArticle(this)">
847:      <div class="article-header"><div class="article-num">01</div><div class="article-title">Participation</div><div class="article-chevron">▾</div></div>
848:      <div class="article-body">
850:        <p>Chaque joueur participant au choc est réputé accepter les termes de cette charte.</p>
854:    <div class="article" onclick="toggleArticle(this)">
855:      <div class="article-header"><div class="article-num">02</div><div class="article-title">Déroulement</div><div class="article-chevron">▾</div></div>
856:      <div class="article-body">
865:    <div class="article" onclick="toggleArticle(this)">
866:      <div class="article-header"><div class="article-num">03</div><div class="article-title">Format des affrontements</div><div class="article-chevron">▾</div></div>
867:      <div class="article-body">
878:    <div class="article" onclick="toggleArticle(this)">
879:      <div class="article-header"><div class="article-num">04</div><div class="article-title">Bonus &amp; Malus</div><div class="article-chevron">▾</div></div>
880:      <div class="article-body">
904:    <div class="article" onclick="toggleArticle(this)">
905:      <div class="article-header"><div class="article-num">05</div><div class="article-title">Exemptions</div><div class="article-chevron">▾</div></div>
906:      <div class="article-body">
968:function toggleArticle(el) { el.classList.toggle('open') }
Read index.htmlRead charte articlesbashsed -n '846,970p' /mnt/user-data/uploads/index.htmlOutput    <div class="article open" onclick="toggleArticle(this)">
      <div class="article-header"><div class="article-num">01</div><div class="article-title">Participation</div><div class="article-chevron">▾</div></div>
      <div class="article-body">
        <p>Tout adhérent·e au club de Bondy est libre de s'inscrire gratuitement au Choc des Renards auprès de Yanis.</p>
        <p>Chaque joueur participant au choc est réputé accepter les termes de cette charte.</p>
      </div>
    </div>

    <div class="article" onclick="toggleArticle(this)">
      <div class="article-header"><div class="article-num">02</div><div class="article-title">Déroulement</div><div class="article-chevron">▾</div></div>
      <div class="article-body">
        <p>Le Choc des Renards s'organise en deux phases :</p>
        <ul>
          <li><strong>Phase 1 — Septembre à Janvier :</strong> l'ensemble des joueurs est réparti dans des poules. À l'issue, les joueurs sont séparés en deux groupes selon leur classement dans leur poule.</li>
          <li><strong>Phase 2 — Février à Juin :</strong> format phases finales en ronde suisse.</li>
        </ul>
      </div>
    </div>

    <div class="article" onclick="toggleArticle(this)">
      <div class="article-header"><div class="article-num">03</div><div class="article-title">Format des affrontements</div><div class="article-chevron">▾</div></div>
      <div class="article-body">
        <ul>
          <li>Les joueurs reçoivent par message le numéro de téléphone et le nom de leur adversaire <strong>un dimanche</strong>.</li>
          <li>Ils ont <strong>deux semaines</strong> à compter de ce jour pour effectuer leur match.</li>
          <li>Le match se déroule en <strong>3 sets gagnants de 11 points secs</strong> (sans points d'écart). Pas de pause pendant le set. Un changement de côté est réalisé à chaque set.</li>
          <li>Les volants sont fournis par les joueurs ou empruntés dans les caisses. Les autres modalités suivent le règlement officiel de la FFBAD.</li>
          <li>À l'issue de l'affrontement, le <strong>vainqueur</strong> communique les scores à Yanis avant <strong>le dernier samedi</strong> de la période des deux semaines.</li>
        </ul>
      </div>
    </div>

    <div class="article" onclick="toggleArticle(this)">
      <div class="article-header"><div class="article-num">04</div><div class="article-title">Bonus &amp; Malus</div><div class="article-chevron">▾</div></div>
      <div class="article-body">
        <p>Afin d'équilibrer certains affrontements, des <strong>désavantages</strong> seront attribués au joueur le mieux classé dans les cas suivants : <strong>P contre R</strong>, <strong>P contre N</strong> ou <strong>D contre N</strong>.</p>
        <p>Le malus est tiré au sort parmi la liste suivante :</p>
        <div class="malus-grid">
          <div class="malus-item">Interdiction de smasher ou de tendre droit</div>
          <div class="malus-item">Porter un cache-œil</div>
          <div class="malus-item">Interdiction de taper le volant au-dessus de la bande</div>
          <div class="malus-item">Jouer en demi-terrain pour le joueur le moins bien classé (le demi-terrain change selon le service en cours)</div>
          <div class="malus-item">Jouer avec une raquette courte</div>
          <div class="malus-item">Jouer avec une raquette lestée</div>
          <div class="malus-item">Jouer avec une raquette de précision</div>
          <div class="malus-item">Jouer avec un bras dans le dos constamment</div>
          <div class="malus-item">Interdiction de faire un coup droit</div>
          <div class="malus-item">Interdiction de faire un revers</div>
          <div class="malus-item">Annoncer chaque coup à voix haute avant de le jouer</div>
          <div class="malus-item">Les couloirs font partie du terrain du joueur le plus classé</div>
          <div class="malus-item">Les points du joueur le moins classé comptent double</div>
          <div class="malus-item">Le point est marqué par le joueur le mieux classé uniquement s'il touche le sol avant la raquette de l'adversaire</div>
          <div class="malus-item">Le joueur le moins classé marque le point</div>
          <div class="malus-item">Zone restrictive changeant à chaque set : rivière, box, couloir du fond, box puis rivière</div>
        </div>
      </div>
    </div>

    <div class="article" onclick="toggleArticle(this)">
      <div class="article-header"><div class="article-num">05</div><div class="article-title">Exemptions</div><div class="article-chevron">▾</div></div>
      <div class="article-body">
        <p>Dans des cas rares (voyage, blessure, maladie, décès…), un affrontement peut être annulé. L'organisation sera très reconnaissante d'être prévenue le plus tôt possible.</p>
        <p><strong>Aucun affrontement</strong> ne sera réalisé durant les <strong>vacances scolaires</strong>.</p>
      </div>
    </div>
  </div>
</div>

<!-- PAGE CLASSEMENT -->
<div id="page-classement" class="page">
  <div class="section">
    <h1 class="section-title">Class<span>ement</span></h1>
    <p class="section-subtitle" id="classement-subtitle">Mise à jour en temps réel</p>
    <div class="info-banner" id="classement-banner">
      <strong id="banner-phase-label">Chargement…</strong> <span id="banner-phase-desc"></span>
    </div>
    <div class="specials-section" id="specials-section" style="display:none">
      <div class="specials-title">🗓 Rencontres en cours</div>
      <div id="specials-list"></div>
    </div>
    <div id="classement-content"><div class="admin-empty">Chargement du classement…</div></div>
  </div>
</div>

<!-- PAGE MES MESSAGES -->
<div id="page-mes-notifs" class="page">
  <div class="section">
    <h1 class="section-title">Mes <span>Messages</span></h1>
    <p class="section-subtitle">Historique des notifications dont vous avez pris connaissance</p>
    <div id="mes-notifs-list"><div class="admin-empty">Chargement…</div></div>
  </div>
</div>

<footer>
  <span>CDR</span> — Le Choc des Renards &mdash; <span id="footer-year"></span>
</footer>

<script defer src="/_vercel/insights/script.js"></script>
<script>
/* ══════════════ ANNÉE DYNAMIQUE ══════════════ */
(function() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0=jan
  // Saison : de sept N à juin N+1
  const seasonStart = m >= 8 ? y : y - 1
  const seasonEnd   = seasonStart + 1
  const tagline = `Saison ${seasonStart} — ${seasonEnd}`
  document.getElementById('hero-tagline').textContent = tagline
  document.getElementById('footer-year').textContent = `Saison ${seasonStart} / ${seasonEnd}`
})()

/* ══════════════ NAVIGATION ══════════════ */
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('page-' + id).classList.add('active')
  if (btn) btn.classList.add('active')
  window.scrollTo(0, 0)
  if (id === 'classement') loadClassement()
  if (id === 'mes-notifs') loadMesNotifs()
}
function toggleArticle(el) { el.classList.toggle('open') }

/* ══════════════ AUTH ══════════════ */
Read CSS and structurebashsed -n '1,150p' /mnt/user-data/uploads/index.htmlOutput<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Le Choc des Renards</title>
<link rel="icon" type="image/png" href="cdr-logo-blanc.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --orange: #FF6D00; --orange-light: #FF9200; --orange-dim: rgba(255,109,0,0.15);
    --dark: #0C0C0C; --dark2: #151515; --dark3: #1E1E1E; --dark4: #2A2A2A;
    --white: #FFFFFF; --gray: #888; --gray-light: #CCC;
    --font-display: 'Bebas Neue', sans-serif;
    --font-heading: 'Barlow Condensed', sans-serif;
    --font-body: 'Barlow', sans-serif;
    /* Catégories */
    --col-N: #FF4444; --col-R: #4488FF; --col-D: #44CC66; --col-P: #FFCC00; --col-NC: #888888;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: var(--dark); color: var(--white); font-family: var(--font-body); font-size: 16px; line-height: 1.6; min-height: 100vh; }

  /* NAV */
  nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(12,12,12,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--dark4); display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; height: 96px; }
  .nav-logo { display: flex; align-items: center; gap: 12px; text-decoration: none; }
  .nav-logo img { height: 88px; width: auto; object-fit: contain; }
  .nav-logo span { font-family: var(--font-display); font-size: 1.4rem; letter-spacing: 0.06em; color: var(--white); }
  .nav-logo span em { color: var(--orange); font-style: normal; }
  .nav-links { display: flex; gap: 4px; }
  .nav-btn { background: none; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 1rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gray); padding: 0.5rem 1rem; border-radius: 6px; transition: all 0.2s; position: relative; }
  .nav-btn:hover { color: var(--white); }
  .nav-btn.active { color: var(--orange); }
  .nav-btn.active::after { content: ''; position: absolute; bottom: 0; left: 1rem; right: 1rem; height: 2px; background: var(--orange); border-radius: 2px; }
  .nav-user-info { display: none; align-items: center; gap: 0.75rem; }
  .nav-user-greeting { font-family: var(--font-heading); font-size: 0.92rem; font-weight: 600; letter-spacing: 0.06em; color: var(--gray-light); }
  .nav-user-greeting strong { color: var(--white); }
  .nav-logout-btn { background: none; border: 1px solid var(--dark4); cursor: pointer; font-family: var(--font-heading); font-size: 0.82rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gray); padding: 0.4rem 0.9rem; border-radius: 6px; transition: all 0.2s; }
  .nav-logout-btn:hover { border-color: var(--orange); color: var(--orange); }

  /* PAGES */
  .page { display: none; padding-top: 96px; min-height: 100vh; }
  .page.active { display: block; }

  /* HERO */
  .hero { min-height: calc(100vh - 96px); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4rem 2rem; position: relative; overflow: hidden; }
  .hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% 30%, rgba(255,109,0,0.08) 0%, transparent 70%); pointer-events: none; }
  .hero::after { content: ''; position: absolute; right: -60px; bottom: -40px; width: 340px; height: 340px; background: url('bondy-badminton-club.png') no-repeat center/contain; opacity: 0.06; pointer-events: none; filter: grayscale(1) brightness(1.2); }
  .hero-logo { width: min(280px, 70vw); margin-bottom: 2rem; filter: drop-shadow(0 0 40px rgba(255,109,0,0.22)); }
  .hero-tagline, .hero-desc, .hero-logo { opacity: 0; transform: translateY(30px) scale(.95); transition: all .8s ease; }
  .hero-logo.visible, .hero-tagline.visible, .hero-desc.visible { opacity: 1; transform: translateY(0) scale(1); }
  .hero-tagline { font-family: var(--font-display); font-size: clamp(1.2rem, 3vw, 1.6rem); letter-spacing: 0.2em; color: var(--orange); margin-bottom: 2.5rem; text-transform: uppercase; }
  .hero-desc { max-width: 560px; font-size: 1.1rem; color: var(--gray-light); line-height: 1.75; margin-bottom: 3rem; }
  .hero-stats { display: flex; gap: 2rem; flex-wrap: wrap; justify-content: center; margin-bottom: 3rem; }
  .stat-card { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.25rem 2rem; text-align: center; min-width: 120px; }
  .stat-num { font-family: var(--font-display); font-size: 2.4rem; color: var(--orange); display: inline-block; }
  .stat-label { font-family: var(--font-heading); font-size: 0.75rem; letter-spacing: 0.12em; color: var(--gray); text-transform: uppercase; }
  .cta-btn { background: var(--orange); color: #000; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.9rem 2.5rem; border-radius: 8px; transition: all 0.2s; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem; }
  .cta-btn:hover { background: var(--orange-light); transform: translateY(-2px); }

  /* SECTION */
  .section { max-width: 860px; margin: 0 auto; padding: 4rem 2rem; }
  .section-title { font-family: var(--font-display); font-size: clamp(2.2rem, 6vw, 3.5rem); letter-spacing: 0.04em; margin-bottom: 0.4rem; }
  .section-title span { color: var(--orange); }
  .section-subtitle { font-family: var(--font-heading); font-size: 0.85rem; letter-spacing: 0.15em; color: var(--gray); text-transform: uppercase; margin-bottom: 3rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--dark4); }
  .reglement-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; background: var(--dark2); border: 1px solid var(--dark4); border-left: 3px solid var(--orange); border-radius: 12px; padding: 1.2rem 1.25rem; margin-bottom: 2rem; }
  .reglement-tools-text { color: var(--gray-light); font-size: 0.96rem; }
  .reglement-tools-text strong { color: var(--white); }
  .pdf-btn { background: var(--orange); color: #000; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.9rem 2.5rem; border-radius: 8px; transition: all 0.2s; text-decoration: none; display: inline-flex; align-items: center; gap: 0.6rem; }
  .pdf-btn:hover { background: var(--orange-light); transform: translateY(-2px); }

  /* RÈGLEMENT */
  .article { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.75rem 2rem; margin-bottom: 1.25rem; transition: border-color 0.2s; }
  .article:hover { border-color: var(--orange); }
  .article-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; cursor: pointer; }
  .article-num { font-family: var(--font-display); font-size: 1.8rem; color: var(--orange); min-width: 48px; }
  .article-title { font-family: var(--font-heading); font-size: 1.15rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; flex: 1; }
  .article-chevron { color: var(--gray); transition: transform 0.25s; font-size: 1.2rem; }
  .article.open .article-chevron { transform: rotate(180deg); }
  .article-body { overflow: hidden; max-height: 0; transition: max-height .4s ease; display: block; }
  .article.open .article-body { max-height: 1600px; }
  .article-body p { color: var(--gray-light); line-height: 1.75; margin-bottom: 0.75rem; font-size: 0.97rem; }
  .article-body ul { padding-left: 0; list-style: none; }
  .article-body ul li { display: flex; gap: 0.75rem; align-items: flex-start; color: var(--gray-light); font-size: 0.95rem; padding: 0.5rem 0; border-bottom: 1px solid var(--dark4); line-height: 1.6; }
  .article-body ul li:last-child { border-bottom: none; }
  .article-body ul li::before { content: '♦'; color: var(--orange); font-size: 0.65rem; margin-top: 0.5rem; flex-shrink: 0; }
  .malus-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.75rem; }
  .malus-item { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 8px; padding: 0.6rem 0.9rem; font-size: 0.88rem; color: var(--gray-light); display: flex; gap: 0.5rem; align-items: flex-start; line-height: 1.5; }
  .malus-item::before { content: '♡'; color: var(--orange); flex-shrink: 0; }

  /* CLASSEMENT */
  .phase-tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .phase-tab { font-family: var(--font-heading); font-size: 0.9rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: var(--dark2); border: 1px solid var(--dark4); color: var(--gray); padding: 0.55rem 1.25rem; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
  .phase-tab.active { background: var(--orange-dim); border-color: var(--orange); color: var(--orange); }
  .phase-tab:hover:not(.active) { border-color: var(--gray); color: var(--gray-light); }
  .phase-content { display: none; }
  .phase-content.active { display: block; }
  .poule-title { font-family: var(--font-heading); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--orange); margin-bottom: 0.75rem; margin-top: 1.5rem; }
  .poule-title:first-child { margin-top: 0; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { border-bottom: 2px solid var(--orange); }
  th { font-family: var(--font-heading); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gray); padding: 0.6rem 0.75rem; text-align: left; }
  th:not(:first-child) { text-align: center; }
  tbody tr { border-bottom: 1px solid var(--dark4); transition: background 0.2s; }
  tbody tr:hover { background: var(--dark2); }
  td { padding: 0.65rem 0.75rem; font-size: 0.95rem; }
  td:not(:first-child) { text-align: center; color: var(--gray-light); }
  .rank { font-family: var(--font-display); font-size: 1.1rem; color: var(--gray); width: 36px; }
  .rank.gold { color: #FFD700; }
  .rank.silver { color: #C0C0C0; }
  .rank.bronze { color: #CD7F32; }
  .player-name { font-weight: 500; }
  /* Badges catégories */
  .player-level { display: inline-block; font-family: var(--font-heading); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; margin-left: 8px; font-weight: 700; }
  .level-N  { background: rgba(255,68,68,0.2);    color: var(--col-N);  border: 1px solid rgba(255,68,68,0.4); }
  .level-R  { background: rgba(68,136,255,0.2);   color: var(--col-R);  border: 1px solid rgba(68,136,255,0.4); }
  .level-D  { background: rgba(68,204,102,0.2);   color: var(--col-D);  border: 1px solid rgba(68,204,102,0.4); }
  .level-P  { background: rgba(255,204,0,0.18);   color: var(--col-P);  border: 1px solid rgba(255,204,0,0.35); }
  .level-NC { background: rgba(136,136,136,0.15); color: var(--col-NC); border: 1px solid rgba(136,136,136,0.3); }
  .pts { font-family: var(--font-display); font-size: 1.15rem; color: var(--white); }
  .winner { background: rgba(255,109,0,0.06); }
  .info-banner { background: var(--dark2); border: 1px solid var(--dark4); border-left: 3px solid var(--orange); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.9rem; color: var(--gray-light); margin-bottom: 1.5rem; }
  .info-banner strong { color: var(--orange); }
  .clickable-row { cursor: pointer; }
  .clickable-row:hover td:first-child { color: var(--orange); }

  /* Rencontres en cours */
  .specials-section { margin-bottom: 2rem; }
  .specials-title { font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--orange); margin-bottom: 0.75rem; }
  .special-card { background: var(--dark2); border: 1px solid var(--dark4); border-left: 3px solid var(--orange); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
  .special-card-players { font-weight: 600; color: var(--white); font-size: 1rem; margin-bottom: 0.3rem; }
  .special-card-meta { font-size: 0.82rem; color: var(--gray); display: flex; gap: 1rem; flex-wrap: wrap; }

  /* MODAL DÉTAIL JOUEUR */
  .player-modal-bg { display: none; position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,0.8); align-items: flex-start; justify-content: center; padding: 5rem 1rem 2rem; overflow-y: auto; }
  .player-modal-bg.open { display: flex; }
  .player-modal { background: var(--dark2); border: 1px solid var(--dark4); border-top: 3px solid var(--orange); border-radius: 14px; padding: 2rem; width: 100%; max-width: 640px; }
  .player-modal-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.5rem; gap: 1rem; }
  .player-modal-name { font-family: var(--font-display); font-size: 1.8rem; letter-spacing: 0.04em; }
  .player-modal-name span { color: var(--orange); }
  .player-modal-close { background: none; border: 1px solid var(--dark4); color: var(--gray); font-size: 1rem; cursor: pointer; padding: 0.3rem 0.7rem; border-radius: 6px; transition: all 0.2s; flex-shrink: 0; }
  .player-modal-close:hover { border-color: var(--gray); color: var(--white); }
  .player-stats-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .player-stat-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 8px; padding: 0.7rem 1.1rem; text-align: center; flex: 1; min-width: 70px; }
  .player-stat-card .val { font-family: var(--font-display); font-size: 1.5rem; color: var(--orange); }
  .player-stat-card .lbl { font-family: var(--font-heading); font-size: 0.68rem; letter-spacing: 0.1em; color: var(--gray); text-transform: uppercase; }
  .matches-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .match-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 10px; padding: 1rem 1.25rem; }
  .match-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem; }


  Read more CSS and admin sections
bash

sed -n '150,350p' /mnt/user-data/uploads/index.html
Output

  .match-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem; }
  .match-opponent { font-weight: 600; color: var(--white); font-size: 0.97rem; }
  .match-phase-badge { font-family: var(--font-heading); font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: var(--orange-dim); color: var(--orange); border: 1px solid rgba(255,109,0,0.3); }
  .match-date { font-size: 0.78rem; color: var(--gray); }
  .match-sets { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.4rem; }
  .set-chip { font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
  .set-win  { background: rgba(100,220,100,0.15); color: #6ddc6d; border: 1px solid rgba(100,220,100,0.3); }
  .set-loss { background: rgba(255,100,100,0.12); color: #ff7070; border: 1px solid rgba(255,100,100,0.3); }
  .match-result-badge { font-family: var(--font-heading); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
  .result-win  { background: rgba(100,220,100,0.15); color: #6ddc6d; }
  .result-loss { background: rgba(255,100,100,0.12); color: #ff7070; }
  .match-note { font-size: 0.82rem; color: var(--gray); margin-top: 0.4rem; font-style: italic; }
  .no-matches { text-align: center; padding: 2rem; color: var(--gray); font-family: var(--font-heading); font-size: 0.9rem; letter-spacing: 0.06em; }

  /* FOOTER */
  footer { border-top: 1px solid var(--dark4); padding: 2rem; text-align: center; font-family: var(--font-heading); font-size: 0.82rem; letter-spacing: 0.08em; color: var(--gray); }
  footer span { color: var(--orange); }

  /* AUTH OVERLAY */
  .auth-overlay { position: fixed; inset: 0; z-index: 999; background: var(--dark); display: flex; align-items: center; justify-content: center; padding: 1rem; opacity: 1; transition: opacity 0.3s ease; }
  .auth-overlay.fade-out { opacity: 0; pointer-events: none; }
  .auth-card { background: var(--dark2); border: 1px solid var(--dark4); border-top: 3px solid var(--orange); border-radius: 16px; padding: 2.5rem 2rem; width: 100%; max-width: 460px; max-height: 92vh; overflow-y: auto; }
  .auth-brand { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 2rem; }
  .auth-brand img { height: 52px; width: auto; object-fit: contain; }
  .auth-brand-text { font-family: var(--font-display); font-size: 1.3rem; letter-spacing: 0.06em; color: var(--white); }
  .auth-brand-text em { color: var(--orange); font-style: normal; }
  .auth-tabs { display: flex; background: var(--dark3); border-radius: 8px; padding: 3px; margin-bottom: 1.75rem; gap: 3px; }
  .auth-tab { flex: 1; background: none; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 0.9rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gray); padding: 0.55rem 1rem; border-radius: 6px; transition: all 0.2s; }
  .auth-tab.active { background: var(--dark); color: var(--orange); box-shadow: 0 1px 6px rgba(0,0,0,0.4); }
  .auth-form { display: none; }
  .auth-form.active { display: block; }
  .form-group { margin-bottom: 1.1rem; }
  .form-group label { display: block; font-family: var(--font-heading); font-size: 0.76rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gray); margin-bottom: 0.4rem; }
  .form-group input, .form-group select, .form-group textarea { width: 100%; background: var(--dark3); border: 1px solid var(--dark4); border-radius: 8px; color: var(--white); font-family: var(--font-body); font-size: 0.97rem; padding: 0.7rem 1rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s; -webkit-appearance: none; appearance: none; }
  .form-group textarea { resize: vertical; min-height: 70px; }
  .form-group input::placeholder, .form-group textarea::placeholder { color: var(--gray); opacity: 0.7; }
  .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255,109,0,0.1); }
  .form-group select { cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 0.9rem center; padding-right: 2.5rem; }
  .form-group select option { background: var(--dark3); color: var(--white); }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .auth-error { font-size: 0.86rem; color: #ff6b6b; margin-bottom: 0.75rem; min-height: 1.25em; line-height: 1.4; }
  .auth-submit { width: 100%; background: var(--orange); color: #000; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.9rem; border-radius: 8px; transition: all 0.2s; margin-top: 0.5rem; }
  .auth-submit:hover:not(:disabled) { background: var(--orange-light); transform: translateY(-1px); }
  .auth-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .checkbox-group { display: flex; align-items: flex-start; gap: 0.75rem; background: var(--dark3); border: 1px solid var(--dark4); border-radius: 8px; padding: 0.9rem 1rem; margin-bottom: 1rem; }
  .checkbox-group input[type=checkbox] { width: 18px; height: 18px; min-width: 18px; margin-top: 2px; accent-color: var(--orange); cursor: pointer; }
  .checkbox-group label { font-size: 0.85rem; color: var(--gray-light); line-height: 1.5; cursor: pointer; }
  .checkbox-group label strong { color: var(--white); }
  .auth-pending { display: none; flex-direction: column; align-items: center; text-align: center; gap: 1rem; padding: 1rem 0; }
  .auth-pending.active { display: flex; }
  .auth-pending-icon { font-size: 3rem; }
  .auth-pending h3 { font-family: var(--font-heading); font-size: 1.2rem; font-weight: 700; letter-spacing: 0.06em; color: var(--white); }
  .auth-pending p { font-size: 0.92rem; color: var(--gray-light); line-height: 1.6; }
  .auth-pending-back { margin-top: 0.5rem; background: none; border: 1px solid var(--dark4); color: var(--gray); font-family: var(--font-heading); font-size: 0.85rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.5rem 1.2rem; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
  .auth-pending-back:hover { border-color: var(--orange); color: var(--orange); }

  /* NOTIFICATION OVERLAY */
  .notif-overlay { display: none; position: fixed; inset: 0; z-index: 1500; background: rgba(0,0,0,0.9); align-items: center; justify-content: center; padding: 1rem; }
  .notif-overlay.open { display: flex; }
  .notif-card { background: var(--dark2); border: 1px solid var(--dark4); border-top: 3px solid var(--orange); border-radius: 16px; padding: 2rem; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
  .notif-card-icon { font-size: 2.5rem; text-align: center; margin-bottom: 1rem; }
  .notif-card-title { font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.04em; text-align: center; margin-bottom: 0.5rem; }
  .notif-card-title span { color: var(--orange); }
  .notif-card-counter { text-align: center; font-family: var(--font-heading); font-size: 0.8rem; letter-spacing: 0.1em; color: var(--gray); margin-bottom: 1.5rem; }
  .notif-card-body { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem; }
  .notif-card-body .notif-type { font-family: var(--font-heading); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--orange); margin-bottom: 0.5rem; }
  .notif-card-body .notif-title { font-family: var(--font-heading); font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem; }
  .notif-card-body .notif-message { font-size: 0.95rem; color: var(--gray-light); line-height: 1.7; }
  .notif-card-body .notif-meta { margin-top: 0.75rem; font-size: 0.82rem; color: var(--gray); display: flex; flex-direction: column; gap: 0.25rem; }
  .notif-ack { display: flex; align-items: flex-start; gap: 0.75rem; background: rgba(255,109,0,0.05); border: 1px solid rgba(255,109,0,0.2); border-radius: 8px; padding: 0.9rem 1rem; margin-bottom: 1rem; cursor: pointer; }
  .notif-ack input[type=checkbox] { width: 18px; height: 18px; min-width: 18px; margin-top: 2px; accent-color: var(--orange); cursor: pointer; }
  .notif-ack label { font-size: 0.88rem; color: var(--gray-light); cursor: pointer; }
  .notif-validate-btn { width: 100%; background: var(--orange); color: #000; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.9rem; border-radius: 8px; transition: all 0.2s; }
  .notif-validate-btn:hover:not(:disabled) { background: var(--orange-light); }
  .notif-validate-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Toast inactivité */
  #inactivity-toast { display: none; position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 9999; background: var(--dark3); border: 1px solid var(--orange); border-radius: 10px; padding: 0.9rem 1.25rem; font-family: var(--font-heading); font-size: 0.88rem; font-weight: 600; letter-spacing: 0.06em; color: var(--gray-light); box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
  #inactivity-toast span { color: var(--orange); }

  /* PANNEAU ADMIN */
  #admin-panel { display: none; padding-top: 96px; min-height: 100vh; }
  #admin-panel.active { display: block; }
  .admin-wrap { max-width: 1100px; margin: 0 auto; padding: 2.5rem 2rem; }
  .admin-title { font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.04em; margin-bottom: 0.25rem; }
  .admin-title span { color: var(--orange); }
  .admin-subtitle { font-family: var(--font-heading); font-size: 0.8rem; letter-spacing: 0.15em; color: var(--gray); text-transform: uppercase; margin-bottom: 2rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--dark4); }
  .admin-tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .admin-tab { font-family: var(--font-heading); font-size: 0.88rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; background: var(--dark2); border: 1px solid var(--dark4); color: var(--gray); padding: 0.55rem 1.25rem; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
  .admin-tab .badge { display: inline-block; background: var(--orange); color: #000; font-size: 0.68rem; font-weight: 700; padding: 1px 5px; border-radius: 10px; margin-left: 6px; vertical-align: middle; }
  .admin-tab.active { background: var(--orange-dim); border-color: var(--orange); color: var(--orange); }
  .admin-tab:hover:not(.active) { border-color: var(--gray); color: var(--gray-light); }
  .admin-section { display: none; }
  .admin-section.active { display: block; }
  .admin-table-wrap { overflow-x: auto; }
  .admin-table { width: 100%; border-collapse: collapse; font-size: 0.91rem; }
  .admin-table thead tr { border-bottom: 2px solid var(--orange); }
  .admin-table th { font-family: var(--font-heading); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gray); padding: 0.6rem 0.75rem; text-align: left; white-space: nowrap; }
  .admin-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--dark4); color: var(--gray-light); vertical-align: middle; }
  .admin-table tbody tr:hover { background: var(--dark2); }
  .admin-actions { display: flex; gap: 0.4rem; flex-wrap: nowrap; align-items: center; min-width: max-content; }
  .btn-sm { font-family: var(--font-heading); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.3rem 0.75rem; border-radius: 5px; border: 1px solid transparent; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .btn-accept  { background: rgba(100,220,100,0.15); color: #6ddc6d; border-color: rgba(100,220,100,0.3); }
  .btn-accept:hover  { background: rgba(100,220,100,0.25); }
  .btn-refuse  { background: rgba(255,100,100,0.12); color: #ff7070; border-color: rgba(255,100,100,0.3); }
  .btn-refuse:hover  { background: rgba(255,100,100,0.22); }
  .btn-ban     { background: rgba(255,150,0,0.12); color: var(--orange-light); border-color: rgba(255,150,0,0.3); }
  .btn-ban:hover     { background: rgba(255,150,0,0.22); }
  .btn-unban   { background: rgba(130,180,255,0.12); color: #82B4FF; border-color: rgba(130,180,255,0.3); }
  .btn-unban:hover   { background: rgba(130,180,255,0.22); }
  .btn-edit    { background: var(--dark3); color: var(--gray-light); border-color: var(--dark4); }
  .btn-edit:hover    { border-color: var(--gray); color: var(--white); }
  .btn-match   { background: rgba(255,109,0,0.12); color: var(--orange); border-color: rgba(255,109,0,0.3); }
  .btn-match:hover   { background: var(--orange-dim); }
  .btn-notif   { background: rgba(130,180,255,0.1); color: #82B4FF; border-color: rgba(130,180,255,0.25); }
  .btn-notif:hover   { background: rgba(130,180,255,0.2); }
  .btn-publish { background: rgba(100,220,100,0.12); color: #6ddc6d; border-color: rgba(100,220,100,0.3); }
  .btn-publish:hover { background: rgba(100,220,100,0.22); }
  .btn-danger  { background: rgba(255,100,100,0.12); color: #ff7070; border-color: rgba(255,100,100,0.3); }
  .btn-danger:hover  { background: rgba(255,100,100,0.22); }
  .btn-activate   { background: rgba(68,204,102,0.12); color: #44CC66; border-color: rgba(68,204,102,0.3); }
  .btn-activate:hover { background: rgba(68,204,102,0.22); }
  .btn-deactivate { background: rgba(136,136,136,0.12); color: #aaa; border-color: rgba(136,136,136,0.3); }
  .btn-deactivate:hover { background: rgba(136,136,136,0.22); }
  .status-badge { display: inline-block; font-family: var(--font-heading); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
  .status-ok       { background: rgba(100,220,100,0.15); color: #6ddc6d; }
  .status-inactive { background: rgba(136,136,136,0.15); color: #aaa; }
  .status-wait     { background: rgba(255,220,50,0.15);  color: #ffd700; }
  .status-banned   { background: rgba(255,100,100,0.15); color: #ff7070; }
  .log-success { color: #6ddc6d; }
  .log-fail    { color: #ff7070; }

  /* Boutons figer/live enfoncés */
  .btn-freeze-active  { background: rgba(255,109,0,0.3) !important; border-color: var(--orange) !important; color: var(--orange) !important; box-shadow: inset 0 2px 4px rgba(0,0,0,0.4); }
  .btn-live-active    { background: rgba(100,220,100,0.25) !important; border-color: #6ddc6d !important; color: #6ddc6d !important; box-shadow: inset 0 2px 4px rgba(0,0,0,0.4); }

  /* Modals */
  .admin-modal-bg { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.7); align-items: center; justify-content: center; padding: 1rem; }
  .admin-modal-bg.open { display: flex; }
  .admin-modal { background: var(--dark2); border: 1px solid var(--dark4); border-top: 3px solid var(--orange); border-radius: 14px; padding: 2rem; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
  .admin-modal h3 { font-family: var(--font-display); font-size: 1.4rem; letter-spacing: 0.04em; margin-bottom: 1.5rem; }
  .admin-modal h3 span { color: var(--orange); }
  .modal-error   { font-size: 0.85rem; color: #ff6b6b; margin-bottom: 0.75rem; min-height: 1.2em; }
  .modal-success { font-size: 0.85rem; color: #6ddc6d; margin-bottom: 0.75rem; min-height: 1.2em; }
  .modal-actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
  .btn-modal-save { flex: 1; background: var(--orange); color: #000; border: none; cursor: pointer; font-family: var(--font-heading); font-size: 0.95rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.75rem; border-radius: 8px; transition: all 0.2s; }
  .btn-modal-save:hover:not(:disabled) { background: var(--orange-light); }
  .btn-modal-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-modal-cancel { flex: 1; background: none; border: 1px solid var(--dark4); color: var(--gray); cursor: pointer; font-family: var(--font-heading); font-size: 0.95rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.75rem; border-radius: 8px; transition: all 0.2s; }
  .btn-modal-cancel:hover { border-color: var(--gray); color: var(--gray-light); }
  .admin-empty { text-align: center; padding: 3rem 1rem; color: var(--gray); font-family: var(--font-heading); font-size: 0.9rem; letter-spacing: 0.06em; }

  /* Sets */
  .sets-container { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem; }
  .set-row { display: flex; align-items: center; gap: 0.5rem; background: var(--dark3); border: 1px solid var(--dark4); border-radius: 8px; padding: 0.5rem 0.75rem; }
  .set-row label { font-family: var(--font-heading); font-size: 0.75rem; letter-spacing: 0.08em; color: var(--gray); text-transform: uppercase; min-width: 52px; }
  .set-row input[type=number] { width: 60px; background: var(--dark); border: 1px solid var(--dark4); border-radius: 6px; color: var(--white); font-family: var(--font-heading); font-size: 0.95rem; font-weight: 700; padding: 0.3rem 0.5rem; text-align: center; outline: none; -moz-appearance: textfield; appearance: textfield; }
  .set-row input[type=number]::-webkit-outer-spin-button,
  .set-row input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .set-row input[type=number]:focus { border-color: var(--orange); }
  .set-row .set-sep { color: var(--gray); font-weight: 700; }
  .set-row .btn-remove-set { background: none; border: none; color: var(--gray); cursor: pointer; font-size: 1rem; padding: 0 0.25rem; line-height: 1; transition: color 0.15s; }
  .set-row .btn-remove-set:hover { color: #ff7070; }
  .btn-add-set { background: none; border: 1px dashed var(--dark4); color: var(--gray); font-family: var(--font-heading); font-size: 0.8rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.45rem 1rem; border-radius: 6px; cursor: pointer; transition: all 0.2s; width: 100%; margin-bottom: 0.75rem; }
  .btn-add-set:hover { border-color: var(--orange); color: var(--orange); }

  /* Phase admin */
  .phase-admin-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.5rem; max-width: 480px; }
  .phase-admin-card h4 { font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--white); margin-bottom: 1rem; }
  .phase-current-display { background: var(--dark2); border: 1px solid var(--orange); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-family: var(--font-heading); font-size: 0.9rem; color: var(--gray-light); }
  .phase-current-display strong { color: var(--orange); }
  #phase-round-group { display: none; }

  /* Poules */
  .poule-admin-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
  .poule-admin-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .poule-admin-name { font-family: var(--font-heading); font-size: 1rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--orange); }
  .poule-members-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
  .poule-member-chip { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 6px; padding: 0.2rem 0.6rem; font-size: 0.83rem; color: var(--gray-light); display: inline-flex; align-items: center; gap: 0.4rem; }
  .poule-member-chip .remove-chip { background: none; border: none; color: var(--gray); cursor: pointer; font-size: 0.9rem; padding: 0; line-height: 1; }
  .poule-member-chip .remove-chip:hover { color: #ff7070; }
  .poule-add-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .poule-add-form select { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 6px; color: var(--white); font-family: var(--font-body); font-size: 0.88rem; padding: 0.4rem 0.75rem; outline: none; cursor: pointer; }
  .poule-add-form select:focus { border-color: var(--orange); }
  .admin-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
  .admin-section-header h3 { font-family: var(--font-heading); font-size: 1.1rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--white); }

  /* Matchs publication */
  .pending-match-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.75rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .pending-match-info { flex: 1; min-width: 200px; }
  .pending-match-player { font-weight: 600; color: var(--white); font-size: 0.95rem; }
  .pending-match-detail { font-size: 0.83rem; color: var(--gray); margin-top: 0.2rem; }
  .pending-match-sets { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.4rem; }
  .pending-match-actions { display: flex; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; }
  .inline-warning { background: rgba(255,200,0,0.1); border: 1px solid rgba(255,200,0,0.3); border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.85rem; color: #ffd700; margin-bottom: 0.75rem; }

  /* Section "Actions autres" */
  .other-actions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .other-action-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 12px; padding: 1.25rem; }
  .other-action-card h4 { font-family: var(--font-heading); font-size: 0.95rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--white); margin-bottom: 0.5rem; }
  .other-action-card p { font-size: 0.83rem; color: var(--gray); line-height: 1.5; margin-bottom: 1rem; }

Read admin sections HTML
bash

sed -n '350,600p' /mnt/user-data/uploads/index.html
Output

  .other-action-card p { font-size: 0.83rem; color: var(--gray); line-height: 1.5; margin-bottom: 1rem; }

  /* Filtre historique */
  .history-filter { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
  .history-filter select { background: var(--dark2); border: 1px solid var(--dark4); border-radius: 6px; color: var(--white); font-family: var(--font-body); font-size: 0.88rem; padding: 0.4rem 0.75rem; outline: none; cursor: pointer; min-width: 200px; }
  .history-filter select:focus { border-color: var(--orange); }

  /* Historique notifications user */
  .notif-history-card { background: var(--dark3); border: 1px solid var(--dark4); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
  .notif-history-title { font-weight: 600; color: var(--white); font-size: 0.95rem; margin-bottom: 0.25rem; }
  .notif-history-meta { font-size: 0.8rem; color: var(--gray); }

  @media (max-width: 600px) {
    .malus-grid { grid-template-columns: 1fr; }
    .hero-stats { gap: 1rem; }
    .stat-card { padding: 1rem 1.25rem; min-width: 90px; }
    nav { padding: 0 1rem; }
    .nav-logo span { display: none; }
    .reglement-tools { flex-direction: column; align-items: flex-start; }
    .pdf-btn { width: 100%; }
    .auth-card { padding: 2rem 1.25rem; }
    .form-row { grid-template-columns: 1fr; gap: 0; }
    .nav-user-greeting { display: none; }
    .player-stats-row { gap: 0.5rem; }
  }
</style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div id="auth-overlay" class="auth-overlay">
  <div class="auth-card">
    <div class="auth-brand">
      <img src="cdr-logo.png" alt="Logo">
      <span class="auth-brand-text">Le Choc des <em>Renards</em></span>
    </div>
    <div class="auth-tabs">
      <button class="auth-tab active" id="tab-login" onclick="switchAuthTab('login')">Connexion</button>
      <button class="auth-tab" id="tab-register" onclick="switchAuthTab('register')">Inscription</button>
    </div>
    <!-- Login : prénom + nom -->
    <div id="form-login" class="auth-form active">
      <div class="form-row">
        <div class="form-group">
          <label for="login-firstname">Prénom</label>
          <input type="text" id="login-firstname" placeholder="Prénom" autocomplete="given-name">
        </div>
        <div class="form-group">
          <label for="login-lastname">Nom</label>
          <input type="text" id="login-lastname" placeholder="Nom" autocomplete="family-name">
        </div>
      </div>
      <div class="form-group">
        <label for="login-password">Mot de passe</label>
        <input type="password" id="login-password" placeholder="••••••••" autocomplete="current-password">
      </div>
      <div id="login-error" class="auth-error"></div>
      <button class="auth-submit" id="login-btn" onclick="handleLogin()">Se connecter</button>
    </div>
    <!-- Register : sans pseudo ni catégorie -->
    <div id="form-register" class="auth-form">
      <div class="form-row">
        <div class="form-group">
          <label for="reg-firstname">Prénom</label>
          <input type="text" id="reg-firstname" placeholder="Prénom" autocomplete="given-name">
        </div>
        <div class="form-group">
          <label for="reg-lastname">Nom</label>
          <input type="text" id="reg-lastname" placeholder="Nom" autocomplete="family-name">
        </div>
      </div>
      <div class="form-group">
        <label for="reg-phone">Téléphone</label>
        <input type="tel" id="reg-phone" placeholder="06 12 34 56 78" autocomplete="tel">
      </div>
      <div class="form-group">
        <label for="reg-password">Mot de passe</label>
        <input type="password" id="reg-password" placeholder="8 caractères minimum" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="reg-confirm">Confirmer le mot de passe</label>
        <input type="password" id="reg-confirm" placeholder="••••••••" autocomplete="new-password">
      </div>
      <div class="checkbox-group">
        <input type="checkbox" id="reg-ack">
        <label for="reg-ack"><strong>J'ai bien pris connaissance de toutes les informations</strong> relatives à mon inscription au Choc des Renards, notamment le règlement, le format des matchs, les bonus &amp; malus, et les conditions de participation.</label>
      </div>
      <div id="reg-error" class="auth-error"></div>
      <button class="auth-submit" id="reg-btn" onclick="handleRegister()">Créer mon compte</button>
    </div>
    <div id="auth-pending" class="auth-pending">
      <div class="auth-pending-icon">⏳</div>
      <h3>Demande envoyée !</h3>
      <p>Votre demande d'inscription a bien été reçue.<br>L'administrateur doit valider votre compte avant que vous puissiez vous connecter.</p>
      <button class="auth-pending-back" onclick="showPendingBack()">← Retour à la connexion</button>
    </div>
  </div>
</div>

<!-- NOTIFICATION OVERLAY -->
<div id="notif-overlay" class="notif-overlay">
  <div class="notif-card">
    <div class="notif-card-icon" id="notif-icon">🦊</div>
    <div class="notif-card-title">Message de <span>l'Admin</span></div>
    <div class="notif-card-counter" id="notif-counter"></div>
    <div class="notif-card-body" id="notif-body"></div>
    <div class="notif-ack" onclick="document.getElementById('notif-ack-cb').click()">
      <input type="checkbox" id="notif-ack-cb" onclick="event.stopPropagation(); updateNotifBtn()">
      <label for="notif-ack-cb">J'ai bien pris connaissance de cette information et je comprends son contenu.</label>
    </div>
    <button class="notif-validate-btn" id="notif-validate-btn" disabled onclick="acknowledgeNotification()">Valider et continuer</button>
  </div>
</div>

<!-- TOAST INACTIVITÉ -->
<div id="inactivity-toast">⏱ Déconnexion dans <span id="inactivity-countdown">60</span>s pour inactivité</div>

<!-- PANNEAU ADMIN -->
<div id="admin-panel">
  <div class="admin-wrap">
    <h1 class="admin-title">Panneau <span>Admin</span></h1>
    <p class="admin-subtitle">Gestion des utilisateurs &amp; du tournoi — Choc des Renards</p>
    <div class="admin-tabs">
      <button class="admin-tab active" onclick="adminTab('users',this)">Utilisateurs <span class="badge" id="badge-users">–</span></button>
      <button class="admin-tab" onclick="adminTab('pending',this)">En attente <span class="badge" id="badge-pending">–</span></button>
      <button class="admin-tab" onclick="adminTab('history',this)">Connexions</button>
      <button class="admin-tab" onclick="adminTab('phase',this)">Phase du tournoi</button>
      <button class="admin-tab" onclick="adminTab('poules',this)">Organiser la phase</button>
      <button class="admin-tab" onclick="adminTab('notify',this)">Notifier un joueur</button>
      <button class="admin-tab" onclick="adminTab('special',this)">Rencontre spéciale</button>
      <button class="admin-tab" onclick="adminTab('publication',this)">Publication matchs <span class="badge" id="badge-pending-matches">–</span></button>
      <button class="admin-tab" onclick="adminTab('notifications-list',this)">Notifications <span class="badge" id="badge-notifs">–</span></button>
      <button class="admin-tab" onclick="adminTab('other-actions',this)">Actions autres</button>
    </div>

    <!-- Utilisateurs -->
    <div id="admin-users" class="admin-section active">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Pseudo</th><th>Nom</th><th>Prénom</th><th>Tél.</th><th>Cat.</th><th>Statut</th><th>Actif</th><th>Inscrit le</th><th>Actions</th></tr></thead>
          <tbody id="tbl-users"></tbody>
        </table>
        <div id="users-empty" class="admin-empty" style="display:none">Aucun utilisateur.</div>
      </div>
    </div>

    <!-- En attente -->
    <div id="admin-pending" class="admin-section">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Pseudo</th><th>Nom</th><th>Prénom</th><th>Tél.</th><th>Cat.</th><th>Demande le</th><th>Actions</th></tr></thead>
          <tbody id="tbl-pending"></tbody>
        </table>
        <div id="pending-empty" class="admin-empty" style="display:none">Aucune demande en attente.</div>
      </div>
    </div>

    <!-- Historique connexions -->
    <div id="admin-history" class="admin-section">
      <div class="history-filter">
        <label style="font-family:var(--font-heading);font-size:0.78rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--gray)">Filtrer par joueur :</label>
        <select id="history-user-filter" onchange="filterHistory()">
          <option value="">— Tous les joueurs —</option>
        </select>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Connexion</th><th>Déconnexion</th><th>Joueur</th><th>Résultat</th><th>Message</th><th>IP</th></tr></thead>
          <tbody id="tbl-history"></tbody>
        </table>
        <div id="history-empty" class="admin-empty" style="display:none">Aucun événement.</div>
      </div>
    </div>

    <!-- Phase -->
    <div id="admin-phase" class="admin-section">
      <div class="phase-admin-card">
        <h4>Phase actuelle</h4>
        <div class="phase-current-display" id="phase-current-display">Chargement…</div>
        <div class="form-group">
          <label>Nouvelle phase</label>
          <select id="phase-select" onchange="onPhaseSelectChange()">
            <option value="PHASE0">Phase 0 — Avant le tournoi</option>
            <option value="PHASE1">Phase 1 — Poules</option>
            <option value="PHASE2">Phase 2 — Finales (ronde suisse)</option>
          </select>
        </div>
        <div class="form-group" id="phase-round-group">
          <label>Numéro de ronde (Phase 2)</label>
          <input type="number" id="phase-round" min="1" value="1">
        </div>
        <div id="phase-error" class="modal-error"></div>
        <button class="btn-modal-save" style="width:100%" id="phase-save-btn" onclick="savePhase()">Enregistrer la phase</button>
      </div>
    </div>

    <!-- Organiser la phase -->
    <div id="admin-poules" class="admin-section">
      <div class="admin-tabs" style="margin-bottom:1.5rem">
        <button class="admin-tab active" onclick="poulesSubTab('phase1',this)">Phase 1 — Poules</button>
        <button class="admin-tab" onclick="poulesSubTab('phase2',this)">Phase 2 — Groupes</button>
      </div>
      <div id="poules-phase1" class="admin-section active">
        <div class="admin-section-header">
          <h3>Gestion des poules</h3>
          <button class="btn-sm btn-accept" onclick="openCreatePouleModal()">+ Nouvelle poule</button>
        </div>
        <div id="poules-list"><div class="admin-empty">Chargement…</div></div>
        <div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--dark4)">
          <h4 style="font-family:var(--font-heading);font-size:0.9rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--gray);margin-bottom:1rem">Joueurs non assignés</h4>
          <div id="unassigned-players" style="display:flex;flex-wrap:wrap;gap:0.4rem"></div>
        </div>
      </div>
      <div id="poules-phase2" class="admin-section">
        <div class="admin-section-header">
          <h3>Groupes Phase 2</h3>
          <div style="display:flex;gap:0.5rem">
            <button class="btn-sm btn-accept" onclick="createDefaultGroups()">Créer les 2 groupes par défaut</button>
            <button class="btn-sm btn-edit" onclick="openCreateGroupModal()">+ Nouveau groupe</button>
          </div>
        </div>
        <div id="groups-list"><div class="admin-empty">Chargement…</div></div>
      </div>
    </div>

    <!-- Notifier -->
    <div id="admin-notify" class="admin-section">
      <div style="max-width:500px">
        <h3 style="font-family:var(--font-heading);font-size:1.2rem;font-weight:700;letter-spacing:0.06em;margin-bottom:1.5rem">Envoyer une notification</h3>
        <div class="form-group"><label>Joueur</label><select id="notify-player-select"><option value="">— Sélectionner —</option></select></div>
        <div class="form-group"><label>Titre</label><input type="text" id="notify-title" placeholder="Ex : Rappel de match…"></div>
        <div class="form-group"><label>Message</label><textarea id="notify-message" rows="4" placeholder="Rédigez votre message…"></textarea></div>
        <div id="notify-error" class="modal-error"></div>
        <div id="notify-success" class="modal-success"></div>
        <button class="btn-modal-save" style="width:100%" onclick="sendNotification()">Envoyer la notification</button>
      </div>
    </div>

    <!-- Rencontre spéciale -->
    <div id="admin-special" class="admin-section">
      <div style="max-width:560px">
        <h3 style="font-family:var(--font-heading);font-size:1.2rem;font-weight:700;letter-spacing:0.06em;margin-bottom:1.5rem">Organiser une rencontre spéciale</h3>
        <div class="form-row">
          <div class="form-group"><label>Joueur 1</label><select id="special-player1"><option value="">— Joueur 1 —</option></select></div>
          <div class="form-group"><label>Joueur 2</label><select id="special-player2"><option value="">— Joueur 2 —</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>À partir du</label><input type="date" id="special-start"></div>
          <div class="form-group"><label>Avant le</label><input type="date" id="special-end"></div>
        </div>
        <div class="form-group"><label>Motif</label><input type="text" id="special-reason" placeholder="Ex : Rattrapage de match…"></div>

Read publication matchs section and rest of admin panel
bash

sed -n '600,830p' /mnt/user-data/uploads/index.html
Output

        <div class="form-group"><label>Motif</label><input type="text" id="special-reason" placeholder="Ex : Rattrapage de match…"></div>
        <div class="form-group"><label>Note / Message (optionnel)</label><textarea id="special-note" rows="3"></textarea></div>
        <div id="special-error" class="modal-error"></div>
        <div id="special-success" class="modal-success"></div>
        <button class="btn-modal-save" style="width:100%" onclick="sendSpecialMatch()">Créer la rencontre &amp; notifier</button>
      </div>
    </div>

    <!-- Publication matchs -->
    <div id="admin-publication" class="admin-section">
      <div class="admin-section-header">
        <h3>Matchs &amp; classement</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn-sm btn-publish" onclick="publishAllMatches()">✓ Publier tous</button>
          <button class="btn-sm btn-ban" id="btn-freeze" onclick="refreshRanking(true)">📌 Figer le classement</button>
          <button class="btn-sm btn-accept" id="btn-live" onclick="refreshRanking(false)">▶ Remettre en live</button>
        </div>
      </div>
      <div id="ranking-status" style="margin-bottom:1rem"></div>

      <!-- Sous-onglets matchs en attente / publiés -->
      <div class="admin-tabs" style="margin-bottom:1rem">
        <button class="admin-tab active" onclick="pubSubTab('pending-matches',this)">En attente <span class="badge" id="badge-pending2">–</span></button>
        <button class="admin-tab" onclick="pubSubTab('published-matches',this)">Publiés (historique)</button>
      </div>
      <div id="pending-matches" class="admin-section active">
        <div id="pending-matches-list"><div class="admin-empty">Chargement…</div></div>
      </div>
      <div id="published-matches" class="admin-section">
        <div id="published-matches-list"><div class="admin-empty">Chargement…</div></div>
      </div>
    </div>

    <!-- Notifications envoyées -->
    <div id="admin-notifications-list" class="admin-section">
      <div class="admin-section-header"><h3>Notifications envoyées</h3></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Joueur</th><th>Type</th><th>Titre</th><th>Envoyée le</th><th>Lu le</th><th>Actions</th></tr></thead>
          <tbody id="tbl-notifications"></tbody>
        </table>
        <div id="notifs-empty" class="admin-empty" style="display:none">Aucune notification.</div>
      </div>
    </div>

    <!-- Actions autres -->
    <div id="admin-other-actions" class="admin-section">
      <h3 style="font-family:var(--font-heading);font-size:1.2rem;font-weight:700;letter-spacing:0.06em;margin-bottom:1.5rem">Actions de fin de saison &amp; maintenance</h3>
      <div class="other-actions-grid">
        <div class="other-action-card">
          <h4>🔒 Suspendre le site</h4>
          <p>Empêche tous les joueurs (non-admin) d'accéder au site et les déconnecte immédiatement.</p>
          <button class="btn-sm btn-danger" onclick="otherAction('suspend_site','Suspendre le site pour tous les joueurs ?')">Suspendre le site</button>
        </div>
        <div class="other-action-card">
          <h4>🔓 Réactiver le site</h4>
          <p>Lève la suspension et permet à nouveau aux joueurs de se connecter.</p>
          <button class="btn-sm btn-accept" onclick="otherAction('unsuspend_site','Réactiver le site ?')">Réactiver le site</button>
        </div>
        <div class="other-action-card">
          <h4>⚡ Déconnecter tout le monde</h4>
          <p>Force la déconnexion de tous les joueurs (hors admins) à leur prochaine action.</p>
          <button class="btn-sm btn-ban" onclick="otherAction('force_logout_all','Déconnecter tous les joueurs ?')">Déconnecter tous</button>
        </div>
        <div class="other-action-card">
          <h4>🗑 Réinitialiser le tournoi</h4>
          <p>Supprime TOUS les matchs, scores, poules, groupes et rencontres spéciales. Action irréversible.</p>
          <button class="btn-sm btn-danger" onclick="otherAction('reset_all_matches','⚠️ ATTENTION : supprimer TOUS les matchs, poules et groupes ? Action IRRÉVERSIBLE.')">Réinitialiser le tournoi</button>
        </div>
        <div class="other-action-card">
          <h4>🔕 Effacer les notifications</h4>
          <p>Supprime toutes les notifications de tous les joueurs.</p>
          <button class="btn-sm btn-danger" onclick="otherAction('reset_all_notifications','Supprimer toutes les notifications ?')">Effacer les notifications</button>
        </div>
        <div class="other-action-card">
          <h4>😴 Désactiver tous les joueurs</h4>
          <p>Passe tous les joueurs en actif=false. Utile en fin de saison pour préparer la suivante.</p>
          <button class="btn-sm btn-deactivate" onclick="otherAction('deactivate_all_players','Passer tous les joueurs en inactif ?')">Désactiver tous</button>
        </div>
      </div>
      <div id="other-actions-feedback" class="modal-success" style="margin-top:1rem"></div>
    </div>

  </div>
</div>

<!-- MODAL ÉDITION UTILISATEUR -->
<div id="edit-modal" class="admin-modal-bg">
  <div class="admin-modal">
    <h3>Modifier <span id="modal-title-name"></span></h3>
    <input type="hidden" id="modal-user-id">
    <div class="form-group"><label>Prénom</label><input type="text" id="modal-firstname"></div>
    <div class="form-group"><label>Nom</label><input type="text" id="modal-lastname"></div>
    <div class="form-group"><label>Pseudo</label><input type="text" id="modal-username"></div>
    <div class="form-group"><label>Téléphone</label><input type="tel" id="modal-phone"></div>
    <div class="form-group">
      <label>Catégorie fédérale</label>
      <select id="modal-category">
        <option value="N">N — National</option>
        <option value="R">R — Régional</option>
        <option value="D">D — Départemental</option>
        <option value="P">P — Promotion</option>
        <option value="NC">NC — Non classé</option>
      </select>
    </div>
    <div id="modal-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeEditModal()">Annuler</button>
      <button class="btn-modal-save" onclick="saveEditModal()">Enregistrer</button>
    </div>
  </div>
</div>

<!-- MODAL AJOUTER / MODIFIER MATCH -->
<div id="match-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:520px">
    <h3 id="match-modal-title">Match — <span id="match-modal-player-name"></span></h3>
    <input type="hidden" id="match-modal-user-id">
    <input type="hidden" id="match-modal-match-id">
    <div id="match-warning" class="inline-warning" style="display:none"></div>
    <!-- Adversaire en dropdown (add) ou champs texte (edit) -->
    <div id="match-opp-dropdown-group" class="form-group">
      <label>Adversaire</label>
      <select id="match-opp-select">
        <option value="">— Sélectionner un joueur actif —</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Phase</label>
        <select id="match-phase" onchange="onMatchPhaseChange()">
          <option value="PHASE0">Phase 0</option>
          <option value="PHASE1">Phase 1 — Poules</option>
          <option value="PHASE2">Phase 2 — Finales</option>
        </select>
      </div>
      <div class="form-group" id="match-round-group" style="display:none">
        <label>Ronde n°</label>
        <input type="number" id="match-round" min="1" value="1">
      </div>
    </div>
    <div class="form-group">
      <label>Date du match</label>
      <input type="date" id="match-date">
    </div>
    <div class="form-group">
      <label>Sets (score joueur – adversaire)</label>
      <div class="sets-container" id="sets-container"></div>
      <button class="btn-add-set" onclick="addSetRow()" id="btn-add-set">+ Ajouter un set</button>
    </div>
    <div class="form-group">
      <label>Note (optionnelle)</label>
      <textarea id="match-note" placeholder="Contexte, malus, remarques…"></textarea>
    </div>
    <div id="match-modal-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeMatchModal()">Annuler</button>
      <button class="btn-modal-save" id="match-save-btn" onclick="saveMatch()">Enregistrer</button>
    </div>
  </div>
</div>

<!-- MODAL CRÉER POULE -->
<div id="create-poule-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:380px">
    <h3>Nouvelle <span>Poule</span></h3>
    <div class="form-group"><label>Nom</label><input type="text" id="new-poule-name" placeholder="Ex : Poule A…"></div>
    <div id="create-poule-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal('create-poule-modal')">Annuler</button>
      <button class="btn-modal-save" onclick="createPoule()">Créer</button>
    </div>
  </div>
</div>

<!-- MODAL CRÉER GROUPE -->
<div id="create-group-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:380px">
    <h3>Nouveau <span>Groupe</span></h3>
    <div class="form-group"><label>Nom</label><input type="text" id="new-group-name" placeholder="Ex : Renards Choquants…"></div>
    <div id="create-group-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal('create-group-modal')">Annuler</button>
      <button class="btn-modal-save" onclick="createGroup()">Créer</button>
    </div>
  </div>
</div>

<!-- MODAL DÉTAIL JOUEUR -->
<div id="player-detail-modal" class="player-modal-bg" onclick="closePlayerDetailOutside(event)">
  <div class="player-modal">
    <div class="player-modal-header">
      <div>
        <div class="player-modal-name" id="pdm-name"></div>
        <div style="font-size:0.85rem;color:var(--gray);margin-top:0.2rem" id="pdm-username"></div>
      </div>
      <button class="player-modal-close" onclick="closePlayerDetail()">✕ Fermer</button>
    </div>
    <div class="player-stats-row" id="pdm-stats"></div>
    <div class="matches-list" id="pdm-matches"></div>
  </div>
</div>

<!-- NAV -->
<nav>
  <a class="nav-logo" href="#" onclick="showPage('accueil', document.querySelector('.nav-btn')); return false;">
    <img src="cdr-logo.png" alt="Logo">
    <span>Le Choc des <em>Renards</em></span>
  </a>
  <div class="nav-links">
    <button class="nav-btn active" onclick="showPage('accueil',this)">Accueil</button>
    <button class="nav-btn" onclick="showPage('reglement',this)">Charte</button>
    <button class="nav-btn" onclick="showPage('classement',this)">Classement</button>
    <button class="nav-btn" onclick="showPage('mes-notifs',this)">Mes messages</button>
  </div>
  <div class="nav-user-info" id="nav-user">
    <span class="nav-user-greeting">Bonjour, <strong id="nav-user-name"></strong> <span id="nav-user-badge" class="player-level"></span></span>
    <button class="nav-logout-btn" onclick="logout()">Déconnexion</button>
  </div>
</nav>

<!-- PAGE ACCUEIL -->
<div id="page-accueil" class="page active">
  <div class="hero">
    <img class="hero-logo" src="bondy-badminton-club.png" alt="Logo Bondy Badminton Club">
    <p class="hero-tagline" id="hero-tagline">Saison — —</p>
    <p class="hero-desc">Le tournoi interne au club de Bondy, de Septembre à Juin. Organisé par Yanis Feddoul, avec l'aide de son élève pour la conception de ce site.</p>
    <div class="hero-stats">
      <div class="stat-card"><div class="stat-num" id="stat-joueurs">–</div><div class="stat-label">Joueurs actifs</div></div>
      <div class="stat-card"><div class="stat-num" id="stat-poules">–</div><div class="stat-label">Poules</div></div>
      <div class="stat-card"><div class="stat-num" id="stat-matchs">–</div><div class="stat-label">Matchs joués</div></div>

Read JS section - auth, logout, admin functions
bash

sed -n '970,1200p' /mnt/user-data/uploads/index.html
Output

/* ══════════════ AUTH ══════════════ */
let currentUser = null
let pendingNotifications = []
let currentNotifIndex = 0

function isTokenValid(token) {
  if (!token) return false
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
    return p.exp * 1000 > Date.now()
  } catch { return false }
}

function initAuth() {
  const token = localStorage.getItem('cdr_token')
  const userStr = localStorage.getItem('cdr_user')
  if (isTokenValid(token) && userStr) {
    try { currentUser = JSON.parse(userStr); showApp(); return } catch {}
  }
  localStorage.removeItem('cdr_token')
  localStorage.removeItem('cdr_user')
  showAuthOverlay()
}

function showApp() {
  const overlay = document.getElementById('auth-overlay')
  overlay.classList.add('fade-out')
  setTimeout(() => { overlay.style.display = 'none' }, 300)
  document.getElementById('nav-user').style.display = 'flex'
  if (currentUser) {
    document.getElementById('nav-user-name').textContent = currentUser.firstName || currentUser.username
    const badge = document.getElementById('nav-user-badge')
    if (currentUser.role === 'ADMIN') {
      badge.textContent = 'ADMIN'; badge.className = 'player-level level-N'
    } else {
      badge.textContent = currentUser.category || 'NC'
      badge.className = 'player-level level-' + (currentUser.category || 'NC')
    }
  }
  if (currentUser && currentUser.role === 'ADMIN') {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    document.getElementById('admin-panel').classList.add('active')
    document.querySelectorAll('.nav-btn').forEach(b => b.style.display = 'none')
    startInactivityTimer()
    loadAdminData()
    loadHomeStats()
  } else {
    document.getElementById('admin-panel').classList.remove('active')
    document.querySelectorAll('.nav-btn').forEach(b => b.style.display = '')
    startInactivityTimer()
    loadHomeStats()
    if (pendingNotifications.length > 0) { currentNotifIndex = 0; showNotifOverlay() }
  }
}

function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay')
  overlay.style.display = 'flex'; overlay.classList.remove('fade-out')
  document.getElementById('nav-user').style.display = 'none'
  document.getElementById('admin-panel').classList.remove('active')
  document.querySelectorAll('.nav-btn').forEach(b => b.style.display = '')
  stopInactivityTimer(); switchAuthTab('login')
}

function logout() {
  // JWT stateless : /api/logout supprimé (n'existait pas), on vide le token localement
  localStorage.removeItem('cdr_token'); localStorage.removeItem('cdr_user')
  currentUser = null; pendingNotifications = []; classementLoaded = false
  showAuthOverlay()
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'))
  document.getElementById('tab-' + tab).classList.add('active')
  document.getElementById('form-' + tab).classList.add('active')
  document.getElementById('login-error').textContent = ''
  document.getElementById('reg-error').textContent = ''
}

async function handleLogin() {
  const firstName = document.getElementById('login-firstname').value.trim()
  const lastName  = document.getElementById('login-lastname').value.trim()
  const password  = document.getElementById('login-password').value
  const errorEl   = document.getElementById('login-error')
  const btn       = document.getElementById('login-btn')
  errorEl.textContent = ''
  if (!firstName || !lastName || !password) { errorEl.textContent = 'Veuillez remplir tous les champs.'; return }
  btn.disabled = true; btn.textContent = 'Connexion…'
  try {
    const res  = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({firstName, lastName, password}) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error || 'Erreur de connexion.'; return }
    localStorage.setItem('cdr_token', data.token)
    localStorage.setItem('cdr_user', JSON.stringify(data.user))
    currentUser = data.user; pendingNotifications = data.pendingNotifications || []
    showApp()
  } catch { errorEl.textContent = 'Erreur réseau. Réessayez.' }
  finally { btn.disabled = false; btn.textContent = 'Se connecter' }
}

async function handleRegister() {
  const firstName = document.getElementById('reg-firstname').value.trim()
  const lastName  = document.getElementById('reg-lastname').value.trim()
  const phone     = document.getElementById('reg-phone').value.trim()
  const password  = document.getElementById('reg-password').value
  const confirm   = document.getElementById('reg-confirm').value
  const ack       = document.getElementById('reg-ack').checked
  const errorEl   = document.getElementById('reg-error')
  const btn       = document.getElementById('reg-btn')
  errorEl.textContent = ''
  if (!firstName || !lastName || !phone || !password || !confirm) { errorEl.textContent = 'Veuillez remplir tous les champs.'; return }
  if (!ack) { errorEl.textContent = 'Vous devez cocher la case de prise de connaissance.'; return }
  if (password !== confirm) { errorEl.textContent = 'Les mots de passe ne correspondent pas.'; return }
  if (password.length < 8) { errorEl.textContent = 'Le mot de passe doit contenir au moins 8 caractères.'; return }
  btn.disabled = true; btn.textContent = 'Création…'
  try {
    const res  = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({firstName, lastName, phone, password, confirmPassword: confirm, acknowledged: ack}) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error || "Erreur lors de l'inscription."; return }
    showPendingMessage()
  } catch { errorEl.textContent = 'Erreur réseau. Réessayez.' }
  finally { btn.disabled = false; btn.textContent = 'Créer mon compte' }
}

function showPendingMessage() {
  document.querySelectorAll('.auth-tab, .auth-form').forEach(el => el.style.display = 'none')
  document.getElementById('auth-pending').classList.add('active')
}
function showPendingBack() {
  document.getElementById('auth-pending').classList.remove('active')
  document.querySelectorAll('.auth-tab').forEach(el => el.style.display = '')
  document.querySelectorAll('.auth-form').forEach(el => el.style.display = '')
  switchAuthTab('login')
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin() })
  document.getElementById('reg-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') handleRegister() })
  initAuth()
})

/* ══════════════ STATS ACCUEIL DYNAMIQUES ══════════════ */
async function loadHomeStats() {
  try {
    const res = await fetch('/api/matches', { headers: authHeaders() })
    if (!res.ok) return
    const data = await res.json()
    const players = data.players || []
    const poules  = data.poules  || []
    // Nombre de joueurs actifs
    document.getElementById('stat-joueurs').textContent = players.length
    // Nombre de poules
    document.getElementById('stat-poules').textContent = poules.length
    // Matchs joués = somme de tous les played / 2 (chaque match compté deux fois)
    const totalPlayed = players.reduce((s, p) => s + (p.played || 0), 0)
    document.getElementById('stat-matchs').textContent = Math.floor(totalPlayed / 2)
    // Animer
    animateCounters()
  } catch(e) { console.error('[loadHomeStats]', e) }
}

/* ══════════════ NOTIFICATIONS BLOQUANTES ══════════════ */
function showNotifOverlay() {
  if (currentNotifIndex >= pendingNotifications.length) {
    document.getElementById('notif-overlay').classList.remove('open'); return
  }
  const notif = pendingNotifications[currentNotifIndex]
  document.getElementById('notif-counter').textContent = `Notification ${currentNotifIndex + 1} / ${pendingNotifications.length}`
  const isSpecial = notif.type === 'special_match'
  document.getElementById('notif-icon').textContent = isSpecial ? '🗓' : '📢'
  const body = document.getElementById('notif-body')
  let metaHtml = ''
  if (isSpecial) {
    if (notif.startDate) metaHtml += `<div>📅 À partir du : <strong>${new Date(notif.startDate).toLocaleDateString('fr-FR')}</strong></div>`
    if (notif.endDate)   metaHtml += `<div>⏰ Avant le : <strong>${new Date(notif.endDate).toLocaleDateString('fr-FR')}</strong></div>`
    if (notif.reason)    metaHtml += `<div>📌 Motif : <strong>${esc(notif.reason)}</strong></div>`
    if (notif.opponentName) metaHtml += `<div>🎯 Adversaire : <strong>${esc(notif.opponentName)}</strong></div>`
  }
  body.innerHTML = `<div class="notif-type">${isSpecial ? 'Rencontre spéciale' : 'Message'}</div>
    <div class="notif-title">${esc(notif.title)}</div>
    <div class="notif-message">${esc(notif.message)}</div>
    ${metaHtml ? `<div class="notif-meta">${metaHtml}</div>` : ''}`
  document.getElementById('notif-ack-cb').checked = false
  document.getElementById('notif-validate-btn').disabled = true
  document.getElementById('notif-overlay').classList.add('open')
}

function updateNotifBtn() {
  document.getElementById('notif-validate-btn').disabled = !document.getElementById('notif-ack-cb').checked
}

async function acknowledgeNotification() {
  const notif = pendingNotifications[currentNotifIndex]
  try {
    await fetch('/api/notifications', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'acknowledge', notificationId: notif.id }) })
  } catch(e) {}
  currentNotifIndex++
  if (currentNotifIndex < pendingNotifications.length) {
    document.getElementById('notif-ack-cb').checked = false
    document.getElementById('notif-validate-btn').disabled = true
    showNotifOverlay()
  } else {
    document.getElementById('notif-overlay').classList.remove('open')
  }
}

/* ══════════════ MES MESSAGES (historique notifs lues) ══════════════ */
async function loadMesNotifs() {
  const list = document.getElementById('mes-notifs-list')
  list.innerHTML = '<div class="admin-empty">Chargement…</div>'
  try {
    const res = await fetch('/api/notifications?history=1', { headers: authHeaders() })
    if (!res.ok) { list.innerHTML = '<div class="admin-empty">Impossible de charger.</div>'; return }
    const { notifications } = await res.json()
    if (!notifications || notifications.length === 0) {
      list.innerHTML = '<div class="admin-empty">Aucun message pris en connaissance pour l\'instant.</div>'; return
    }
    list.innerHTML = notifications.map(n => `
      <div class="notif-history-card">
        <div class="notif-history-title">${esc(n.title)}</div>
        <div style="font-size:0.9rem;color:var(--gray-light);margin:0.3rem 0">${esc(n.message)}</div>
        <div class="notif-history-meta">Lu le ${fmtDate(n.readAt)} · ${n.type === 'special_match' ? '🗓 Rencontre spéciale' : '📢 Message'}</div>
      </div>`).join('')
  } catch(e) { list.innerHTML = '<div class="admin-empty">Erreur de chargement.</div>' }
}

/* ══════════════ INACTIVITÉ ══════════════ */
const INACTIVITY_MS = 15 * 60 * 1000
const WARN_BEFORE_MS = 60 * 1000
let inactivityTimer = null, warnTimer = null, warnCountdown = null

Read admin JS functions
bash

sed -n '1200,1500p' /mnt/user-data/uploads/index.html
Output

let inactivityTimer = null, warnTimer = null, warnCountdown = null

function resetInactivityTimer() {
  clearTimeout(inactivityTimer); clearTimeout(warnTimer); clearInterval(warnCountdown)
  document.getElementById('inactivity-toast').style.display = 'none'
  warnTimer = setTimeout(() => {
    const toast = document.getElementById('inactivity-toast')
    const span = document.getElementById('inactivity-countdown')
    toast.style.display = 'block'; let secs = 60; span.textContent = secs
    warnCountdown = setInterval(() => { secs--; span.textContent = secs; if (secs <= 0) clearInterval(warnCountdown) }, 1000)
  }, INACTIVITY_MS - WARN_BEFORE_MS)
  inactivityTimer = setTimeout(() => logout(), INACTIVITY_MS)
}
function startInactivityTimer() {
  ;['mousemove','keydown','click','scroll','touchstart'].forEach(e => document.addEventListener(e, resetInactivityTimer, {passive:true}))
  resetInactivityTimer()
}
function stopInactivityTimer() {
  clearTimeout(inactivityTimer); clearTimeout(warnTimer); clearInterval(warnCountdown)
  document.getElementById('inactivity-toast').style.display = 'none'
  ;['mousemove','keydown','click','scroll','touchstart'].forEach(e => document.removeEventListener(e, resetInactivityTimer))
}

/* ══════════════ CLASSEMENT ══════════════ */
let classementLoaded = false
let classementPlayers = []

function phaseLabel(phase, round) {
  if (phase === 'PHASE0') return 'Phase 0 — Avant le tournoi'
  if (phase === 'PHASE1') return 'Phase 1 — Poules'
  if (phase === 'PHASE2') return round ? `Phase 2 — Finales · Ronde ${round}` : 'Phase 2 — Finales'
  return phase || '—'
}

async function loadClassement() {
  classementLoaded = true
  const container = document.getElementById('classement-content')
  container.innerHTML = '<div class="admin-empty">Chargement…</div>'
  loadSpecials()
  try {
    const res = await fetch('/api/matches', { headers: authHeaders() })
    if (!res.ok) { container.innerHTML = '<div class="admin-empty">Impossible de charger le classement.</div>'; return }
    const { phase, round, players, poules, phase2Groups, fromSnapshot } = await res.json()
    classementPlayers = players || []

    document.getElementById('banner-phase-label').textContent = phaseLabel(phase, round)
    // fromSnapshot visible seulement admin (mais côté frontend on le cache aux users de toute façon)
    document.getElementById('banner-phase-desc').textContent = ''

    if (!players || players.length === 0) {
      container.innerHTML = '<div class="admin-empty">Aucun joueur inscrit pour l\'instant.</div>'; return
    }

    let html = ''
    html += `<div class="phase-tabs">`
    html += `<button class="phase-tab active" onclick="switchClassTab('general',this)">Général</button>`
    if (phase === 'PHASE1' && poules && poules.length > 0)
      html += `<button class="phase-tab" onclick="switchClassTab('poules',this)">Poules</button>`
    if (phase2Groups && phase2Groups.length > 0)
      html += `<button class="phase-tab" onclick="switchClassTab('groups',this)">Groupes</button>`
    html += `</div>`

    html += `<div id="class-general" class="phase-content active">`
    html += renderRankingTable(players)
    html += `<p style="font-size:0.78rem;color:var(--gray);margin-top:1rem;text-align:right">Cliquez sur un joueur pour voir le détail de ses matchs.</p>`
    html += `</div>`

    if (phase === 'PHASE1' && poules && poules.length > 0) {
      html += `<div id="class-poules" class="phase-content">`
      for (const p of poules) {
        html += `<div class="poule-title">🏓 ${esc(p.name)}</div>`
        html += renderRankingTable(p.members || [])
      }
      html += `</div>`
    }

    if (phase2Groups && phase2Groups.length > 0) {
      html += `<div id="class-groups" class="phase-content">`
      for (const g of phase2Groups) {
        const gMembers = (g.members || []).map(m => {
          const pl = players.find(p => p.id === (m.userId || m.id))
          return pl || { ...m.user, points: 0, wins: 0, losses: 0, played: 0, setDiff: 0 }
        })
        html += `<div class="poule-title">🦊 ${esc(g.name)}</div>`
        html += renderGroupList(gMembers)
      }
      html += `</div>`
    }

    container.innerHTML = html
    bindPlayerRows()
  } catch(e) {
    console.error('[loadClassement]', e)
    container.innerHTML = '<div class="admin-empty">Erreur de chargement.</div>'
  }
}

function bindPlayerRows() {
  document.querySelectorAll('.clickable-row').forEach(row => {
    row.onclick = () => {
      const pid = parseInt(row.dataset.playerId)
      const player = classementPlayers.find(p => p.id === pid)
      if (player) showPlayerDetail(player)
    }
  })
}

function renderRankingTable(sorted) {
  let html = `<table><thead><tr><th>#</th><th>Pseudo</th><th>Cat.</th><th>J</th><th>V</th><th>D</th><th>Sets</th><th>Pts</th></tr></thead><tbody>`
  sorted.forEach((p, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''
    const winnerClass = i < 2 ? 'winner' : ''
    const diff = p.setDiff > 0 ? '+' + p.setDiff : p.setDiff
    html += `<tr class="clickable-row ${winnerClass}" data-player-id="${p.id}">
      <td class="rank ${rankClass}">${i+1}</td>
      <td class="player-name">${esc(p.username)}</td>
      <td><span class="player-level level-${p.category || 'NC'}">${p.category || 'NC'}</span></td>
      <td>${p.played}</td><td>${p.wins}</td><td>${p.losses}</td>
      <td>${diff}</td><td class="pts">${p.points}</td>
    </tr>`
  })
  html += '</tbody></table>'
  return html
}

function renderGroupList(members) {
  return `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.5rem">`
    + (members || []).map(m => `<div class="poule-member-chip">${esc(m.username || m.firstName+' '+m.lastName)} <span class="player-level level-${m.category || 'NC'}" style="margin-left:4px">${m.category || 'NC'}</span></div>`).join('')
    + `</div>`
}

function switchClassTab(id, btn) {
  document.querySelectorAll('.phase-content').forEach(c => c.classList.remove('active'))
  document.querySelectorAll('.phase-tab').forEach(b => b.classList.remove('active'))
  const el = document.getElementById('class-' + id)
  if (el) el.classList.add('active')
  if (btn) btn.classList.add('active')
  bindPlayerRows()
}

async function loadSpecials() {
  try {
    const res = await fetch('/api/matches?public=1')
    if (!res.ok) return
    const { specials } = await res.json()
    const section = document.getElementById('specials-section')
    const list = document.getElementById('specials-list')
    if (!specials || specials.length === 0) { section.style.display = 'none'; return }
    section.style.display = 'block'
    list.innerHTML = specials.map(sm => `
      <div class="special-card">
        <div class="special-card-players">🏸 ${esc(sm.player1?.firstName||'?')} ${esc(sm.player1?.lastName||'?')} <span style="color:var(--gray)">vs</span> ${esc(sm.player2?.firstName||'?')} ${esc(sm.player2?.lastName||'?')}</div>
        <div class="special-card-meta">
          <span>📅 À partir du ${new Date(sm.startDate).toLocaleDateString('fr-FR')}</span>
          <span>⏰ Avant le ${new Date(sm.endDate).toLocaleDateString('fr-FR')}</span>
          <span>📌 ${esc(sm.reason)}</span>
        </div>
      </div>`).join('')
  } catch(e) {}
}

/* Détail joueur */
function showPlayerDetail(player) {
  document.getElementById('pdm-name').innerHTML = `${esc(player.firstName)} <span>${esc(player.lastName)}</span>`
  document.getElementById('pdm-username').textContent = '@' + player.username + ' · ' + (player.category || 'NC')
  const diff = player.setDiff > 0 ? '+' + player.setDiff : player.setDiff
  document.getElementById('pdm-stats').innerHTML = `
    <div class="player-stat-card"><div class="val">${player.played}</div><div class="lbl">Matchs</div></div>
    <div class="player-stat-card"><div class="val">${player.wins}</div><div class="lbl">Victoires</div></div>
    <div class="player-stat-card"><div class="val">${player.losses}</div><div class="lbl">Défaites</div></div>
    <div class="player-stat-card"><div class="val">${diff}</div><div class="lbl">Sets ±</div></div>
    <div class="player-stat-card"><div class="val">${player.points}</div><div class="lbl">Points</div></div>`
  const matchesEl = document.getElementById('pdm-matches')
  if (!player.matches || player.matches.length === 0) {
    matchesEl.innerHTML = '<div class="no-matches">Aucun match enregistré.</div>'
  } else {
    matchesEl.innerHTML = player.matches.map(m => {
      const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
      const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
      const won = pw > ow
      const setChips = m.sets.sort((a,b)=>a.setNumber-b.setNumber).map(s => {
        const cls = s.playerScore > s.opponentScore ? 'set-win' : 'set-loss'
        return `<span class="set-chip ${cls}">${s.playerScore}–${s.opponentScore}</span>`
      }).join('')
      const phaseTxt = m.phase === 'PHASE0' ? 'Phase 0' : m.phase === 'PHASE1' ? 'Phase 1' : m.roundNumber ? `Phase 2 · R${m.roundNumber}` : 'Phase 2'
      return `<div class="match-card">
        <div class="match-card-header">
          <span class="match-opponent">vs ${esc(m.opponentFirstName)} ${esc(m.opponentLastName)}</span>
          <span class="match-result-badge ${won ? 'result-win':'result-loss'}">${won ? 'Victoire':'Défaite'}</span>
          <span class="match-phase-badge">${phaseTxt}</span>
        </div>
        <div class="match-date">${fmtDateOnly(m.matchDate)}</div>
        <div class="match-sets">${setChips}</div>
        ${m.note ? `<div class="match-note">📝 ${esc(m.note)}</div>` : ''}
      </div>`
    }).join('')
  }
  document.getElementById('player-detail-modal').classList.add('open')
}
function closePlayerDetail() { document.getElementById('player-detail-modal').classList.remove('open') }
function closePlayerDetailOutside(e) { if (e.target === document.getElementById('player-detail-modal')) closePlayerDetail() }

/* ══════════════ ADMIN ══════════════ */
function adminTab(name, btn) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.admin-tabs > .admin-tab').forEach(b => b.classList.remove('active'))
  document.getElementById('admin-' + name).classList.add('active')
  btn.classList.add('active')
  if (name === 'phase') loadPhase()
  if (name === 'poules') loadPoules()
  if (name === 'publication') loadPendingMatches()
  if (name === 'notifications-list') loadNotificationsList()
  if (name === 'notify' || name === 'special') loadPlayersForNotify()
  if (name === 'history') loadHistory()
}

function pubSubTab(name, btn) {
  document.querySelectorAll('#admin-publication .admin-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('#admin-publication .admin-tabs .admin-tab').forEach(b => b.classList.remove('active'))
  document.getElementById(name).classList.add('active')
  btn.classList.add('active')
}

function poulesSubTab(name, btn) {
  document.querySelectorAll('#admin-poules .admin-section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('#admin-poules > .admin-tabs .admin-tab').forEach(b => b.classList.remove('active'))
  document.getElementById('poules-' + name).classList.add('active')
  btn.classList.add('active')
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('cdr_token') }
}

async function loadAdminData() {
  await Promise.all([loadUsers(), loadHistory()])
}

/* ── Utilisateurs ── */
async function loadUsers() {
  try {
    const res = await fetch('/api/admin/action', { headers: authHeaders() })
    if (!res.ok) return
    const { users } = await res.json()
    const accepted = users.filter(u => u.accepted && !u.banned)
    const pending  = users.filter(u => !u.accepted && !u.banned)
    const banned   = users.filter(u => u.banned)

    document.getElementById('badge-users').textContent   = accepted.length + banned.length
    document.getElementById('badge-pending').textContent = pending.length

    const tblU = document.getElementById('tbl-users')
    const allActive = [...accepted, ...banned]
    if (allActive.length === 0) {
      tblU.innerHTML = ''; document.getElementById('users-empty').style.display = 'block'
    } else {
      document.getElementById('users-empty').style.display = 'none'
      tblU.innerHTML = allActive.map(u => `
        <tr>
          <td><strong style="color:var(--white)">${esc(u.username)}</strong></td>
          <td>${esc(u.lastName)}</td><td>${esc(u.firstName)}</td><td>${esc(u.phone)}</td>
          <td><span class="player-level level-${u.category || 'NC'}">${u.category || 'NC'}</span></td>
          <td>${u.banned ? '<span class="status-badge status-banned">Banni</span>' : '<span class="status-badge status-ok">Accepté</span>'}</td>
          <td>${u.active ? '<span class="status-badge status-ok">Actif</span>' : '<span class="status-badge status-inactive">Inactif</span>'}</td>
          <td style="color:var(--gray);font-size:0.82rem">${fmtDate(u.createdAt)}</td>
          <td>
            <div class="admin-actions">
              <button class="btn-sm btn-edit" onclick="openEditModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">Modifier</button>
              <button class="btn-sm btn-match" onclick="openMatchModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">+ Match</button>
              <button class="btn-sm btn-notif" onclick="quickNotify(${u.id},'${esc(u.firstName)} ${esc(u.lastName)}')">✉</button>
              ${u.active
                ? `<button class="btn-sm btn-deactivate" onclick="adminAction('deactivate',${u.id})">Désactiver</button>`
                : `<button class="btn-sm btn-activate"   onclick="adminAction('activate',${u.id})">Activer</button>`}
              ${u.banned
                ? `<button class="btn-sm btn-unban" onclick="adminAction('unban',${u.id})">Débannir</button>
                   <button class="btn-sm btn-danger" onclick="adminAction('delete_banned',${u.id})" title="Supprimer définitivement">🗑</button>`
                : `<button class="btn-sm btn-ban" onclick="adminAction('ban',${u.id})">Bannir</button>`}
            </div>
          </td>
        </tr>`).join('')
    }

    const tblP = document.getElementById('tbl-pending')
    if (pending.length === 0) {
      tblP.innerHTML = ''; document.getElementById('pending-empty').style.display = 'block'
    } else {
      document.getElementById('pending-empty').style.display = 'none'
      tblP.innerHTML = pending.map(u => `
        <tr>
          <td><strong style="color:var(--white)">${esc(u.username)}</strong></td>
          <td>${esc(u.lastName)}</td><td>${esc(u.firstName)}</td><td>${esc(u.phone)}</td>
          <td><span class="player-level level-${u.category || 'NC'}">${u.category || 'NC'}</span></td>
          <td style="color:var(--gray);font-size:0.82rem">${fmtDate(u.createdAt)}</td>
          <td>
            <div class="admin-actions">
              <button class="btn-sm btn-accept" onclick="adminAction('accept',${u.id})">✓ Accepter</button>
              <button class="btn-sm btn-refuse" onclick="adminAction('refuse',${u.id})">✗ Refuser</button>
            </div>
          </td>
        </tr>`).join('')
    }

Read more admin JS - history, matches, publication
bash

sed -n '1500,1800p' /mnt/user-data/uploads/index.html
Output

    }

    // Populate filtre historique
    const histFilter = document.getElementById('history-user-filter')
    const currentVal = histFilter.value
    const allUsers = [...accepted, ...banned, ...pending]
    histFilter.innerHTML = '<option value="">— Tous les joueurs —</option>' +
      allUsers.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)} (@${esc(u.username)})</option>`).join('')
    histFilter.value = currentVal

  } catch(e) { console.error('[loadUsers]', e) }
}

/* ── Historique ── */
let historyAllEvents = []

async function loadHistory() {
  try {
    const res = await fetch('/api/admin/history?limit=300', { headers: authHeaders() })
    if (!res.ok) return
    const { events } = await res.json()
    historyAllEvents = events
    renderHistory(events)
  } catch(e) { console.error('[loadHistory]', e) }
}

function filterHistory() {
  const userId = document.getElementById('history-user-filter').value
  if (!userId) { renderHistory(historyAllEvents); return }
  const uid = parseInt(userId, 10)
  renderHistory(historyAllEvents.filter(e => e.userId === uid))
}

function renderHistory(events) {
  const tbl = document.getElementById('tbl-history')
  if (events.length === 0) { tbl.innerHTML = ''; document.getElementById('history-empty').style.display = 'block'; return }
  document.getElementById('history-empty').style.display = 'none'
  tbl.innerHTML = events.map(e => {
    // Déconnexion : si logoutAt = inactivité (15min after), sinon manuelle
    let logoutDisplay = '—'
    if (e.logoutAt) {
      const loginTime = new Date(e.createdAt).getTime()
      const logoutTime = new Date(e.logoutAt).getTime()
      const diffMs = logoutTime - loginTime
      // Si exactement 15min (tolérance ±1min) → inactivité → retirer 15min
      if (diffMs >= 14 * 60 * 1000 && diffMs <= 16 * 60 * 1000) {
        const adjusted = new Date(logoutTime - 15 * 60 * 1000)
        logoutDisplay = `<span style="color:var(--gray)">~${fmtDate(adjusted)} <small>(inactivité)</small></span>`
      } else {
        logoutDisplay = fmtDate(e.logoutAt)
      }
    }
    return `<tr>
      <td style="color:var(--gray);font-size:0.82rem;white-space:nowrap">${fmtDate(e.createdAt)}</td>
      <td style="font-size:0.82rem;white-space:nowrap">${logoutDisplay}</td>
      <td><strong style="color:var(--white)">${esc(e.user?.username||'—')}</strong><br><span style="font-size:0.78rem;color:var(--gray)">${esc(e.user?.firstName||'')} ${esc(e.user?.lastName||'')}</span></td>
      <td>${e.success ? '<span class="log-success">✓ Succès</span>' : '<span class="log-fail">✗ Échec</span>'}</td>
      <td style="font-size:0.85rem;color:var(--gray-light)">${esc(e.message||'—')}</td>
      <td style="font-size:0.78rem;color:var(--gray)">${esc(e.ip||'—')}</td>
    </tr>`
  }).join('')
}

/* ── Actions admin ── */
async function adminAction(action, userId) {
  const labels = { accept:'Accepter', refuse:'Refuser et supprimer', ban:'Bannir', unban:'Débannir', delete_banned:'Supprimer définitivement ce joueur banni', activate:'Activer', deactivate:'Désactiver' }
  if (!confirm(`${labels[action]||action} cet utilisateur ?`)) return
  try {
    const res  = await fetch('/api/admin/action', { method:'POST', headers: authHeaders(), body: JSON.stringify({action, userId}) })
    const data = await res.json()
    if (!res.ok) { alert(data.error||'Erreur.'); return }
    await loadUsers()
  } catch { alert('Erreur réseau.') }
}

/* ── Edition utilisateur ── */
function openEditModal(user) {
  document.getElementById('modal-user-id').value = user.id
  document.getElementById('modal-title-name').textContent = user.username
  document.getElementById('modal-firstname').value  = user.firstName
  document.getElementById('modal-lastname').value   = user.lastName
  document.getElementById('modal-username').value   = user.username
  document.getElementById('modal-phone').value      = user.phone
  document.getElementById('modal-category').value   = user.category || 'NC'
  document.getElementById('modal-error').textContent = ''
  document.getElementById('edit-modal').classList.add('open')
}
function closeEditModal() { document.getElementById('edit-modal').classList.remove('open') }
async function saveEditModal() {
  const userId = parseInt(document.getElementById('modal-user-id').value, 10)
  const errorEl = document.getElementById('modal-error')
  errorEl.textContent = ''
  const data = {
    firstName: document.getElementById('modal-firstname').value.trim(),
    lastName:  document.getElementById('modal-lastname').value.trim(),
    username:  document.getElementById('modal-username').value.trim(),
    phone:     document.getElementById('modal-phone').value.trim(),
    category:  document.getElementById('modal-category').value,
  }
  if (!data.firstName || !data.lastName || !data.username || !data.phone || !data.category) { errorEl.textContent = 'Tous les champs sont requis.'; return }
  try {
    const res = await fetch('/api/admin/action', { method:'POST', headers: authHeaders(), body: JSON.stringify({action:'update', userId, data}) })
    const json = await res.json()
    if (!res.ok) { errorEl.textContent = json.error||'Erreur.'; return }
    closeEditModal(); await loadUsers()
  } catch { errorEl.textContent = 'Erreur réseau.' }
}
document.getElementById('edit-modal').addEventListener('click', function(e) { if (e.target===this) closeEditModal() })

/* ── Phase ── */
async function loadPhase() {
  try {
    const res = await fetch('/api/admin/phase', { headers: authHeaders() })
    if (!res.ok) return
    const { phase, round, rankingSnapshot } = await res.json()
    document.getElementById('phase-current-display').innerHTML = `Phase actuelle : <strong>${phaseLabel(phase, round)}</strong>`
    document.getElementById('phase-select').value = phase
    document.getElementById('phase-round').value = round || 1
    document.getElementById('phase-round-group').style.display = phase === 'PHASE2' ? 'block' : 'none'
    // Mettre à jour les boutons figer/live
    updateFreezeBtns(!!rankingSnapshot)
  } catch(e) { console.error('[loadPhase]', e) }
}
function onPhaseSelectChange() {
  document.getElementById('phase-round-group').style.display = document.getElementById('phase-select').value === 'PHASE2' ? 'block' : 'none'
}
async function savePhase() {
  const phase = document.getElementById('phase-select').value
  const round = parseInt(document.getElementById('phase-round').value, 10)
  const errorEl = document.getElementById('phase-error')
  const btn = document.getElementById('phase-save-btn')
  errorEl.textContent = ''
  if (phase === 'PHASE2' && (!round || round < 1)) { errorEl.textContent = 'Numéro de ronde requis.'; return }
  btn.disabled = true; btn.textContent = 'Enregistrement…'
  try {
    const res = await fetch('/api/admin/phase', { method:'POST', headers: authHeaders(), body: JSON.stringify({ phase, round: phase === 'PHASE2' ? round : undefined }) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
    document.getElementById('phase-current-display').innerHTML = `Phase actuelle : <strong>${phaseLabel(data.phase, data.round)}</strong>`
    errorEl.style.color = '#6ddc6d'; errorEl.textContent = '✓ Phase mise à jour.'
    setTimeout(() => { errorEl.textContent = ''; errorEl.style.color = '' }, 3000)
  } catch { errorEl.textContent = 'Erreur réseau.' }
  finally { btn.disabled = false; btn.textContent = 'Enregistrer la phase' }
}

function updateFreezeBtns(isFrozen) {
  const btnFreeze = document.getElementById('btn-freeze')
  const btnLive   = document.getElementById('btn-live')
  if (!btnFreeze || !btnLive) return
  if (isFrozen) {
    btnFreeze.classList.add('btn-freeze-active'); btnLive.classList.remove('btn-live-active')
    document.getElementById('ranking-status').innerHTML = `<div style="font-size:0.83rem;color:var(--orange)">📌 Classement actuellement <strong>figé</strong></div>`
  } else {
    btnLive.classList.add('btn-live-active'); btnFreeze.classList.remove('btn-freeze-active')
    document.getElementById('ranking-status').innerHTML = `<div style="font-size:0.83rem;color:#6ddc6d">▶ Classement actuellement en <strong>live</strong></div>`
  }
}

/* ── Match modal ── */
let setCount = 0
let matchModalMode = 'add' // 'add' | 'edit'
let activeUsers = []

function onMatchPhaseChange() {
  document.getElementById('match-round-group').style.display = document.getElementById('match-phase').value === 'PHASE2' ? 'block' : 'none'
}

function addSetRow() {
  if (setCount >= 5) return
  setCount++
  const num = setCount
  const row = document.createElement('div')
  row.className = 'set-row'; row.id = 'set-row-' + num
  row.innerHTML = `<label>Set ${num}</label>
    <input type="number" id="set-player-${num}" min="0" max="99" value="0">
    <span class="set-sep">–</span>
    <input type="number" id="set-opp-${num}" min="0" max="99" value="0">
    <button class="btn-remove-set" onclick="removeSetRow(${num})">✕</button>`
  document.getElementById('sets-container').appendChild(row)
  if (setCount >= 5) document.getElementById('btn-add-set').style.display = 'none'
}

function removeSetRow(num) {
  const row = document.getElementById('set-row-' + num)
  if (row) row.remove()
  setCount = document.querySelectorAll('#sets-container .set-row').length
  document.querySelectorAll('#sets-container .set-row').forEach((r, i) => { r.querySelector('label').textContent = 'Set ' + (i+1) })
  document.getElementById('btn-add-set').style.display = ''
}

function populateOppDropdown() {
  const sel = document.getElementById('match-opp-select')
  sel.innerHTML = '<option value="">— Sélectionner un adversaire —</option>' +
    activeUsers.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)} (@${esc(u.username)}) — ${u.category || 'NC'}</option>`).join('')
}

function openMatchModal(user) {
  matchModalMode = 'add'
  document.getElementById('match-modal-title').innerHTML = 'Ajouter un match — <span id="match-modal-player-name">' + esc(user.firstName) + ' ' + esc(user.lastName) + '</span>'
  document.getElementById('match-modal-user-id').value = user.id
  document.getElementById('match-modal-match-id').value = ''
  document.getElementById('match-opp-dropdown-group').style.display = 'block'
  populateOppDropdown()
  // Exclure le joueur lui-même du dropdown
  Array.from(document.getElementById('match-opp-select').options).forEach(opt => {
    if (parseInt(opt.value) === user.id) opt.style.display = 'none'
  })
  document.getElementById('match-phase').value = 'PHASE1'
  document.getElementById('match-round-group').style.display = 'none'
  document.getElementById('match-round').value = '1'
  document.getElementById('match-date').value = new Date().toISOString().slice(0,10)
  document.getElementById('match-note').value = ''
  document.getElementById('match-modal-error').textContent = ''
  document.getElementById('match-warning').style.display = 'none'
  document.getElementById('sets-container').innerHTML = ''
  setCount = 0
  document.getElementById('btn-add-set').style.display = ''
  addSetRow()
  document.getElementById('match-modal').classList.add('open')
}

function openEditMatchModal(match) {
  matchModalMode = 'edit'
  document.getElementById('match-modal-title').innerHTML = 'Modifier le match'
  document.getElementById('match-modal-user-id').value = match.userId || ''
  document.getElementById('match-modal-match-id').value = match.id
  document.getElementById('match-opp-dropdown-group').style.display = 'none'
  document.getElementById('match-phase').value = match.phase || 'PHASE1'
  document.getElementById('match-round-group').style.display = match.phase === 'PHASE2' ? 'block' : 'none'
  document.getElementById('match-round').value = match.roundNumber || 1
  document.getElementById('match-date').value = match.matchDate ? match.matchDate.slice(0,10) : ''
  document.getElementById('match-note').value = match.note || ''
  document.getElementById('match-modal-error').textContent = ''
  document.getElementById('match-warning').style.display = 'none'
  document.getElementById('sets-container').innerHTML = ''
  setCount = 0
  document.getElementById('btn-add-set').style.display = ''
  if (match.sets && match.sets.length > 0) {
    match.sets.forEach(s => {
      addSetRow()
      document.getElementById('set-player-' + setCount).value = s.playerScore
      document.getElementById('set-opp-' + setCount).value = s.opponentScore
    })
  } else { addSetRow() }
  document.getElementById('match-modal').classList.add('open')
}

function closeMatchModal() { document.getElementById('match-modal').classList.remove('open') }

async function saveMatch() {
  const errorEl = document.getElementById('match-modal-error')
  const btn     = document.getElementById('match-save-btn')
  errorEl.textContent = ''
  const phase     = document.getElementById('match-phase').value
  const round     = parseInt(document.getElementById('match-round').value, 10)
  const matchDate = document.getElementById('match-date').value
  const note      = document.getElementById('match-note').value.trim()
  if (!matchDate) { errorEl.textContent = 'Date du match requise.'; return }
  const setRows = document.querySelectorAll('#sets-container .set-row')
  if (setRows.length === 0) { errorEl.textContent = 'Ajoutez au moins un set.'; return }
  const sets = []
  let valid = true
  setRows.forEach((row, i) => {
    const ps = parseInt(row.querySelector('input:nth-of-type(1)').value, 10)
    const os = parseInt(row.querySelector('input:nth-of-type(2)').value, 10)
    if (isNaN(ps) || isNaN(os) || ps < 0 || os < 0) { valid = false; return }
    sets.push({ setNumber: i+1, playerScore: ps, opponentScore: os })
  })
  if (!valid) { errorEl.textContent = 'Scores invalides.'; return }
  btn.disabled = true; btn.textContent = 'Enregistrement…'
  try {
    if (matchModalMode === 'edit') {
      const matchId = parseInt(document.getElementById('match-modal-match-id').value, 10)
      const res = await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'edit', matchId, matchDate, note: note||null, sets }) })
      const data = await res.json()
      if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
      closeMatchModal(); await loadPendingMatches()
    } else {
      const userId   = parseInt(document.getElementById('match-modal-user-id').value, 10)
      const opponentId = document.getElementById('match-opp-select').value
      if (!opponentId) { errorEl.textContent = 'Sélectionnez un adversaire.'; btn.disabled=false; btn.textContent='Enregistrer'; return }
      const body = { action:'add', userId, phase, matchDate, opponentId: parseInt(opponentId, 10), note: note||undefined, sets }
      if (phase === 'PHASE2') body.round = round
      const res = await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
      if (data.warning) {
        const w = document.getElementById('match-warning')
        w.textContent = '⚠ ' + data.warning; w.style.display = 'block'
        setTimeout(() => closeMatchModal(), 4000)
      } else { closeMatchModal() }
      if (document.getElementById('admin-publication').classList.contains('active')) loadPendingMatches()
    }
  } catch { errorEl.textContent = 'Erreur réseau.' }
  finally { btn.disabled = false; btn.textContent = 'Enregistrer' }
}
document.getElementById('match-modal').addEventListener('click', function(e) { if (e.target===this) closeMatchModal() })

/* ── Poules ── */
let poulesData = { poules: [], unassigned: [], groups: [], unassignedGroups: [], allUsers: [] }

Maintenant j'ai une vue d'ensemble complète. Je vais maintenant lire le schema.prisma et commencer à tout implémenter.Read prisma schemaRead prisma schemaMaintenant j'ai tout ce qu'il me faut. Je vais implémenter toutes les modifications. Voici ce que je vais faire :

schema.prisma — ajout PlannedMatch + RefusedRegistration
action.js — logger le refus avec nom/prénom/tél/date, ajouter historique refusés
match.js — gérer PlannedMatch (CRUD), conversion en match réel, score rencontre spéciale simplifié
notifications.js (admin) — envoi groupé avec filtre actifs/inactifs
login.js — logger logoutAt à la déconnexion + flag inactivité
index.html — toutes les modifications frontend
Ran 5 commandsRan 5 commandsWrite new schema.prismabashcat > /home/claude/schema.prisma << 'SCHEMA_EOF'
// schema.prisma — Choc des Renards

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

enum Category {
  N
  R
  D
  P
  NC
}

enum Phase {
  PHASE0
  PHASE1
  PHASE2
}

model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  firstName    String
  lastName     String
  phone        String
  category     Category @default(NC)
  role         Role     @default(USER)
  accepted     Boolean  @default(false)
  banned       Boolean  @default(false)
  active       Boolean  @default(true)
  forceLogout  Boolean  @default(false)
  createdAt    DateTime @default(now())

  matches        Match[]
  pouleMembers   PouleMember[]
  phase2Members  Phase2GroupMember[]
  notifications  Notification[]
  loginEvents    LoginEvent[]
  specialMatches1 SpecialMatch[] @relation("Player1")
  specialMatches2 SpecialMatch[] @relation("Player2")
  plannedMatches1 PlannedMatch[] @relation("PlannedPlayer1")
  plannedMatches2 PlannedMatch[] @relation("PlannedPlayer2")
}

model LoginEvent {
  id        Int      @id @default(autoincrement())
  userId    Int
  ip        String?
  userAgent String?
  success   Boolean
  message   String?
  createdAt DateTime @default(now())
  logoutAt  DateTime?
  logoutReason String? // 'manual' | 'inactivity'

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Historique des inscriptions refusées (conservé après suppression du compte)
model RefusedRegistration {
  id        Int      @id @default(autoincrement())
  firstName String
  lastName  String
  phone     String
  refusedAt DateTime @default(now())
}

model TournamentState {
  id              Int     @id @default(autoincrement())
  currentPhase    Phase   @default(PHASE0)
  currentRound    Int?
  rankingSnapshot String?
  siteSuspended   Boolean @default(false)
}

model Poule {
  id        Int      @id @default(autoincrement())
  name      String
  phase     Phase    @default(PHASE1)
  createdAt DateTime @default(now())
  members   PouleMember[]
}

model PouleMember {
  id      Int  @id @default(autoincrement())
  pouleId Int
  userId  Int

  poule Poule @relation(fields: [pouleId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([pouleId, userId])
}

model Phase2Group {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now())
  members   Phase2GroupMember[]
}

model Phase2GroupMember {
  id      Int @id @default(autoincrement())
  groupId Int
  userId  Int

  group Phase2Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user  User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
}

model Match {
  id                Int      @id @default(autoincrement())
  userId            Int
  phase             Phase
  roundNumber       Int?
  matchDate         DateTime
  opponentFirstName String
  opponentLastName  String
  note              String?
  published         Boolean  @default(false)
  specialMatchId    Int?
  createdAt         DateTime @default(now())

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  sets         MatchSet[]
  specialMatch SpecialMatch? @relation(fields: [specialMatchId], references: [id])
}

model MatchSet {
  id            Int @id @default(autoincrement())
  matchId       Int
  setNumber     Int
  playerScore   Int
  opponentScore Int

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)
}

model SpecialMatch {
  id        Int      @id @default(autoincrement())
  player1Id Int
  player2Id Int
  startDate DateTime
  endDate   DateTime
  reason    String
  note      String?
  resolved  Boolean  @default(false)
  createdAt DateTime @default(now())

  player1  User    @relation("Player1", fields: [player1Id], references: [id])
  player2  User    @relation("Player2", fields: [player2Id], references: [id])
  matches  Match[]
}

// Matchs planifiés (à venir, non encore joués)
model PlannedMatch {
  id          Int      @id @default(autoincrement())
  player1Id   Int
  player2Id   Int
  scheduledDate DateTime?
  malus       String?  // enum value or null
  malusTarget Int?     // 1 = player1, 2 = player2
  note        String?
  phase       Phase    @default(PHASE1)
  roundNumber Int?
  createdAt   DateTime @default(now())

  player1 User @relation("PlannedPlayer1", fields: [player1Id], references: [id])
  player2 User @relation("PlannedPlayer2", fields: [player2Id], references: [id])
}

model Notification {
  id           Int      @id @default(autoincrement())
  userId       Int
  type         String   // 'message' | 'special_match'
  title        String
  message      String
  opponentName String?
  startDate    DateTime?
  endDate      DateTime?
  reason       String?
  read         Boolean  @default(false)
  readAt       DateTime?
  createdAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
SCHEMA_EOF
echo "schema done"Outputschema done
Write updated action.jsbashcat > /home/claude/action.js << 'EOF'
// api/admin/action.js
// ─ Actions sur un utilisateur (accept, refuse, ban, unban, activate, deactivate, update, delete_banned)
// ─ Actions globales (suspend_site, unsuspend_site, force_logout_all, reset_all_matches,
//                     reset_all_notifications, deactivate_all_players)
// ─ GET → liste de tous les utilisateurs
// ─ GET ?refused=1 → historique des inscriptions refusées
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

  // ── GET : liste de tous les utilisateurs OU historique refusés ────────────
  if (req.method === 'GET') {
    try {
      // Historique des inscriptions refusées
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
          accepted: true, banned: true, active: true, createdAt: true,
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Actions GLOBALES (pas de userId requis)
  // ══════════════════════════════════════════════════════════════════════════════
  const globalActions = [
    'suspend_site', 'unsuspend_site', 'force_logout_all',
    'reset_all_matches', 'reset_all_notifications', 'deactivate_all_players',
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
          await prisma.matchSet.deleteMany({})
          await prisma.match.deleteMany({})
          await prisma.pouleMember.deleteMany({})
          await prisma.poule.deleteMany({})
          await prisma.phase2GroupMember.deleteMany({})
          await prisma.phase2Group.deleteMany({})
          await prisma.specialMatch.deleteMany({})
          await prisma.plannedMatch.deleteMany({})
          await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { rankingSnapshot: null, currentPhase: 'PHASE0', currentRound: null },
            create: { id: 1, currentPhase: 'PHASE0' },
          })
          return res.status(200).json({ ok: true, message: 'Tous les matchs, scores, poules et groupes ont été supprimés. Tournoi réinitialisé.' })
        }

        case 'reset_all_notifications': {
          await prisma.notification.deleteMany({})
          return res.status(200).json({ ok: true, message: 'Toutes les notifications ont été supprimées.' })
        }

        case 'deactivate_all_players': {
          await prisma.user.updateMany({
            where: { role: 'USER', username: { notIn: ADMIN_USERNAMES } },
            data: { active: false },
          })
          return res.status(200).json({ ok: true, message: 'Tous les joueurs ont été mis en inactif.' })
        }
      }
    } catch (err) {
      console.error('[admin/action global]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Actions sur un utilisateur précis (userId requis)
  // ══════════════════════════════════════════════════════════════════════════════
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
        // Conserver une trace avant suppression
        await prisma.refusedRegistration.create({
          data: {
            firstName: user.firstName,
            lastName:  user.lastName,
            phone:     user.phone,
          },
        })
        await prisma.user.delete({ where: { id } })
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
        await prisma.user.delete({ where: { id } })
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

      case 'update': {
        if (!data) return res.status(400).json({ error: 'Données de mise à jour manquantes.' })
        const { firstName, lastName, username, phone, category } = data
        const validCategories = ['N', 'R', 'D', 'P', 'NC']
        if (category && !validCategories.includes(category))
          return res.status(400).json({ error: 'Catégorie invalide.' })
        if (username && username !== user.username) {
          if (ADMIN_USERNAMES.includes(username.toLowerCase()))
            return res.status(400).json({ error: 'Ce pseudo est réservé.' })
          const existing = await prisma.user.findUnique({ where: { username } })
          if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' })
        }
        const updateData = {}
        if (firstName) updateData.firstName = firstName
        if (lastName)  updateData.lastName  = lastName
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
EOF
echo "action.js done"Outputaction.js done
Write updated login.js with logout trackingbashcat > /home/claude/login.js << 'EOF'
// api/login.js
const { PrismaClient } = require('@prisma/client')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)
if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

async function logLogin(userId, req, success, message) {
  try {
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    const ip = rawIp ? rawIp.split(',')[0].trim() : null

    await prisma.loginEvent.create({
      data: {
        userId,
        ip,
        userAgent: req.headers['user-agent'] || null,
        success,
        message: message || null,
      },
    })
  } catch (e) { console.error('[LOGIN_LOG]', e) }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── POST /api/login?action=logout — enregistrer la déconnexion ──────────────
  if (req.method === 'POST' && req.query?.action === 'logout') {
    const { loginEventId, reason } = req.body || {}
    if (loginEventId) {
      try {
        const eid = parseInt(loginEventId, 10)
        if (!isNaN(eid)) {
          await prisma.loginEvent.update({
            where: { id: eid },
            data: {
              logoutAt: new Date(),
              logoutReason: reason === 'inactivity' ? 'inactivity' : 'manual',
            },
          })
        }
      } catch(e) { console.error('[logout log]', e) }
    }
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { firstName, lastName, password } = req.body || {}

  if (!firstName || !lastName || !password) {
    return res.status(400).json({ error: 'Prénom, nom et mot de passe requis.' })
  }

  try {
    const state = await prisma.tournamentState.findUnique({ where: { id: 1 } })

    const user = await prisma.user.findFirst({
      where: {
        firstName: { equals: firstName.trim(), mode: 'insensitive' },
        lastName:  { equals: lastName.trim(),  mode: 'insensitive' },
      },
    })

    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      if (['admin', 'root'].includes(user.username.toLowerCase())) {
        try {
          await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: process.env.ADMIN_EMAIL,
            subject: '⚠️ Tentative de connexion ADMIN',
            html: `<h2>Tentative de connexion ADMIN</h2><p><strong>Résultat :</strong> mauvais mot de passe</p><p><strong>IP :</strong> ${(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()}</p>`,
          })
        } catch (mailErr) { console.error('[EMAIL ADMIN]', mailErr) }
      }
      await logLogin(user.id, req, false, 'Mot de passe incorrect')
      return res.status(401).json({ error: 'Identifiants incorrects.' })
    }

    const isAdmin = ['admin', 'root'].includes(user.username.toLowerCase()) || user.role === 'ADMIN'

    if (!isAdmin && state?.siteSuspended) {
      await logLogin(user.id, req, false, 'Site suspendu')
      return res.status(403).json({ error: 'Le site est temporairement suspendu. Revenez plus tard.' })
    }

    if (user.banned) {
      await logLogin(user.id, req, false, 'Compte banni')
      return res.status(403).json({ error: 'Votre compte a été banni. Contactez l\'administrateur.' })
    }

    if (!user.accepted) {
      await logLogin(user.id, req, false, 'Compte en attente de validation')
      return res.status(403).json({ error: 'Votre demande d\'inscription est en attente de validation par l\'administrateur.' })
    }

    if (user.forceLogout) {
      await prisma.user.update({ where: { id: user.id }, data: { forceLogout: false } })
    }

    if (isAdmin) {
      try {
        await resend.emails.send({
          from: 'onboarding@resend.dev',
          to: process.env.ADMIN_EMAIL,
          subject: '✅ Connexion ADMIN réussie',
          html: `<h2>Connexion ADMIN réussie</h2><p><strong>Pseudo :</strong> ${user.username}</p><p><strong>IP :</strong> ${(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()}</p>`,
        })
      } catch (mailErr) { console.error('[EMAIL ADMIN]', mailErr) }
    }

    // Créer l'événement de login et retourner son ID pour pouvoir logger le logout
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    const ip = rawIp ? rawIp.split(',')[0].trim() : null
    const loginEvent = await prisma.loginEvent.create({
      data: {
        userId: user.id,
        ip,
        userAgent: req.headers['user-agent'] || null,
        success: true,
        message: 'Connexion réussie',
      },
    })

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: isAdmin ? 'ADMIN' : user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    )

    let pendingNotifications = []
    if (!isAdmin) {
      pendingNotifications = await prisma.notification.findMany({
        where: { userId: user.id, read: false },
        orderBy: { createdAt: 'desc' },
      })
    }

    return res.status(200).json({
      token,
      loginEventId: loginEvent.id,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: isAdmin ? 'ADMIN' : user.role,
        category: user.category,
        active: user.active,
      },
      pendingNotifications,
    })
  } catch (err) {
    console.error('[login]', err)
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' })
  }
}
EOF
echo "login.js done"Outputlogin.js done
Write updated match.js with planned matches and special score entrybashcat > /home/claude/match.js << 'EOF'
// api/admin/match.js
const { PrismaClient } = require('@prisma/client')
const { requireAdmin } = require('../_auth')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

const MALUS_LIST = [
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

function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0
  for (const m of matches) {
    const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
    const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++; if (pw > ow) wins++; else losses++
    setDiff += pw - ow
  }
  return { played, wins, losses, setDiff, points: wins * 3 + losses }
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.played !== b.played) return a.played - b.played
    if (b.points !== a.points) return b.points - a.points
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const payload = requireAdmin(req, res)
  if (!payload) return

  // ── GET : matchs en attente + publiés + liste joueurs actifs + matchs planifiés
  if (req.method === 'GET') {
    try {
      const [pending, published, activeUsers, openSpecials, planned] = await Promise.all([
        prisma.match.findMany({
          where: { published: false },
          orderBy: { createdAt: 'desc' },
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.match.findMany({
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          take: 200,
          include: {
            sets: { orderBy: { setNumber: 'asc' } },
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
          },
        }),
        prisma.user.findMany({
          where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
          select: { id: true, firstName: true, lastName: true, username: true, category: true },
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
            player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
            player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          },
        }),
      ])
      return res.status(200).json({ pending, published, activeUsers, openSpecials, planned, malusList: MALUS_LIST })
    } catch (err) {
      console.error('[admin/match GET]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { action } = req.body || {}

  // ── PUBLISH ──────────────────────────────────────────────────────────────────
  if (action === 'publish') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.update({ where: { id: mid }, data: { published: true } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── PUBLISH ALL ──────────────────────────────────────────────────────────────
  if (action === 'publish_all') {
    try {
      const { count } = await prisma.match.updateMany({ where: { published: false }, data: { published: true } })
      return res.status(200).json({ ok: true, count })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  // ── EDIT (modifier un match publié ou en attente) ────────────────────────────
  if (action === 'edit') {
    const { matchId, matchDate, opponentFirstName, opponentLastName, note, sets } = req.body
    const mid = parseInt(matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    if (!sets || !Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })
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
        include: { sets: { orderBy: { setNumber: 'asc' } } },
      })
      return res.status(200).json({ ok: true, match: updated })
    } catch (err) {
      console.error('[admin/match edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── REFRESH RANKING ──────────────────────────────────────────────────────────
  if (action === 'refresh_ranking') {
    const freeze = req.body.freeze !== false
    try {
      if (!freeze) {
        await prisma.tournamentState.update({ where: { id: 1 }, data: { rankingSnapshot: null } })
        return res.status(200).json({ ok: true, message: 'Classement remis en live.' })
      }

      const users = await prisma.user.findMany({
        where: { accepted: true, banned: false, active: true, username: { notIn: ADMIN_USERNAMES } },
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

  // ── ADD ──────────────────────────────────────────────────────────────────────
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

  // ── ADD FROM SPECIAL (score rencontre spéciale, convertit le match planifié) ──
  if (action === 'add_from_special') {
    const { specialMatchId, matchDate, note, sets } = req.body

    const smid = parseInt(specialMatchId, 10)
    if (isNaN(smid)) return res.status(400).json({ error: 'specialMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

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

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const mid = parseInt(req.body.matchId, 10)
    if (isNaN(mid)) return res.status(400).json({ error: 'matchId invalide.' })
    try {
      await prisma.match.delete({ where: { id: mid } })
      return res.status(200).json({ ok: true, message: 'Match supprimé.' })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── PLANNED : créer un match planifié ────────────────────────────────────────
  if (action === 'planned_add') {
    const { player1Id, player2Id, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    if (!player1Id || !player2Id) return res.status(400).json({ error: 'Les deux joueurs sont requis.' })
    const p1id = parseInt(player1Id, 10)
    const p2id = parseInt(player2Id, 10)
    if (isNaN(p1id) || isNaN(p2id) || p1id === p2id)
      return res.status(400).json({ error: 'Joueurs invalides.' })
    try {
      const pm = await prisma.plannedMatch.create({
        data: {
          player1Id: p1id,
          player2Id: p2id,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: malus || null,
          malusTarget: malusTarget ? parseInt(malusTarget, 10) : null,
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

  // ── PLANNED : modifier ────────────────────────────────────────────────────────
  if (action === 'planned_edit') {
    const { plannedMatchId, scheduledDate, malus, malusTarget, note, phase, round } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      const pm = await prisma.plannedMatch.update({
        where: { id: pmid },
        data: {
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          malus: malus || null,
          malusTarget: malusTarget ? parseInt(malusTarget, 10) : null,
          note: note ? note.trim() : null,
          phase: phase || 'PHASE1',
          roundNumber: phase === 'PHASE2' ? (parseInt(round, 10) || null) : null,
        },
        include: {
          player1: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
          player2: { select: { id: true, firstName: true, lastName: true, username: true, category: true } },
        },
      })
      return res.status(200).json({ ok: true, plannedMatch: pm })
    } catch (err) {
      console.error('[planned_edit]', err)
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── PLANNED : supprimer ───────────────────────────────────────────────────────
  if (action === 'planned_delete') {
    const pmid = parseInt(req.body.plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    try {
      await prisma.plannedMatch.delete({ where: { id: pmid } })
      return res.status(200).json({ ok: true })
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur ou match introuvable.' })
    }
  }

  // ── PLANNED → convertir en match réel ────────────────────────────────────────
  if (action === 'planned_convert') {
    const { plannedMatchId, matchDate, note, sets } = req.body
    const pmid = parseInt(plannedMatchId, 10)
    if (isNaN(pmid)) return res.status(400).json({ error: 'plannedMatchId invalide.' })
    if (!matchDate) return res.status(400).json({ error: 'Date du match requise.' })
    if (!Array.isArray(sets) || sets.length === 0 || sets.length > 5)
      return res.status(400).json({ error: 'Entre 1 et 5 sets requis.' })

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

      // Créer les deux matchs miroir
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

      // Supprimer le match planifié
      await prisma.plannedMatch.delete({ where: { id: pmid } })

      return res.status(201).json({ ok: true, match1: m1, match2: m2 })
    } catch (err) {
      console.error('[planned_convert]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  return res.status(400).json({ error: 'Action invalide.' })
}
EOF
echo "match.js done"Outputmatch.js done
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
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Fix 4: matches live always - matches.js handles this server-side
# The frontend already shows matches from player data, which comes from /api/matches
# The key change: when rankingSnapshot is set, we still need to show live match counts
# but frozen RANKING POSITIONS. This is done server-side in matches.js already
# (rankingSnapshot stores frozen positions). The frontend just displays what it gets.
# So no frontend change needed for match count - they're always computed from published matches.
# The snapshot already includes computed stats. The fix is that snapshot should include
# matches array too for player detail. That's a server-side change in matches.js - 
# For now the user detail uses /api/matches?userId=X which is always live.
print("Matches live - handled server-side, no frontend change needed for player detail")

# Fix 5: Add "Matchs planifiés" tab in admin panel
old_tabs = '      <button class="admin-tab" onclick="adminTab(\'publication\',this)">Publication matchs <span class="badge" id="badge-pending-matches">–</span></button>'
new_tabs = '      <button class="admin-tab" onclick="adminTab(\'planned\',this)">Matchs planifiés <span class="badge" id="badge-planned">–</span></button>\n      <button class="admin-tab" onclick="adminTab(\'publication\',this)">Publication matchs <span class="badge" id="badge-pending-matches">–</span></button>'
if old_tabs in content:
    content = content.replace(old_tabs, new_tabs)
    print('Added Matchs planifiés tab')
else:
    print('Tab pattern not found')

# Fix 6: Add "Refusés" tab in admin panel (after "En attente")
old_pending_tab = '      <button class="admin-tab" onclick="adminTab(\'history\',this)">Connexions</button>'
new_pending_tab = '      <button class="admin-tab" onclick="adminTab(\'refused\',this)">Refusés</button>\n      <button class="admin-tab" onclick="adminTab(\'history\',this)">Connexions</button>'
if old_pending_tab in content:
    content = content.replace(old_pending_tab, new_pending_tab)
    print('Added Refusés tab')
else:
    print('Refused tab pattern not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Matches live - handled server-side, no frontend change needed for player detail
Added Matchs planifiés tab
Added Refusés tab

Add HTML sections for refused and planned
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Add admin sections for refused and planned after admin-history section
old_history_end = '''    <!-- Phase -->
    <div id="admin-phase" class="admin-section">'''

new_sections = '''    <!-- Inscriptions refusées -->
    <div id="admin-refused" class="admin-section">
      <div class="admin-section-header"><h3>Inscriptions refusées</h3></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Prénom</th><th>Nom</th><th>Téléphone</th><th>Refusé le</th></tr></thead>
          <tbody id="tbl-refused"></tbody>
        </table>
        <div id="refused-empty" class="admin-empty" style="display:none">Aucune inscription refusée.</div>
      </div>
    </div>

    <!-- Phase -->
    <div id="admin-phase" class="admin-section">'''

if old_history_end in content:
    content = content.replace(old_history_end, new_sections)
    print('Added refused section')
else:
    print('History end pattern not found')

# Add planned matches section before publication section
old_pub_section = '''    <!-- Publication matchs -->
    <div id="admin-publication" class="admin-section">'''

new_planned_section = '''    <!-- Matchs planifiés -->
    <div id="admin-planned" class="admin-section">
      <div class="admin-section-header">
        <h3>Matchs planifiés (à venir)</h3>
        <button class="btn-sm btn-accept" onclick="openPlannedAddModal()">+ Planifier un match</button>
      </div>
      <div id="planned-matches-list"><div class="admin-empty">Chargement…</div></div>
    </div>

    <!-- Publication matchs -->
    <div id="admin-publication" class="admin-section">'''

if old_pub_section in content:
    content = content.replace(old_pub_section, new_planned_section)
    print('Added planned matches section')
else:
    print('Publication section not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Added refused section
Added planned matches section

Update notify section for multi-player
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Update the notify section to support multi-player
old_notify_section = '''    <!-- Notifier -->
    <div id="admin-notify" class="admin-section">
      <div style="max-width:500px">
        <h3 style="font-family:var(--font-heading);font-size:1.2rem;font-weight:700;letter-spacing:0.06em;margin-bottom:1.5rem">Envoyer une notification</h3>
        <div class="form-group"><label>Joueur</label><select id="notify-player-select"><option value="">— Sélectionner —</option></select></div>
        <div class="form-group"><label>Titre</label><input type="text" id="notify-title" placeholder="Ex : Rappel de match…"></div>
        <div class="form-group"><label>Message</label><textarea id="notify-message" rows="4" placeholder="Rédigez votre message…"></textarea></div>
        <div id="notify-error" class="modal-error"></div>
        <div id="notify-success" class="modal-success"></div>
        <button class="btn-modal-save" style="width:100%" onclick="sendNotification()">Envoyer la notification</button>
      </div>
    </div>'''

new_notify_section = '''    <!-- Notifier -->
    <div id="admin-notify" class="admin-section">
      <div style="max-width:560px">
        <h3 style="font-family:var(--font-heading);font-size:1.2rem;font-weight:700;letter-spacing:0.06em;margin-bottom:1.5rem">Envoyer une notification</h3>
        <div class="form-group">
          <label>Destinataires</label>
          <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap">
            <button class="btn-sm btn-edit" onclick="notifySelectAll(true)">Tout le monde</button>
            <button class="btn-sm btn-edit" onclick="notifySelectAll(false)">Tout désélectionner</button>
            <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.82rem;color:var(--gray);cursor:pointer">
              <input type="checkbox" id="notify-active-only" checked onchange="renderNotifyPlayerList()">
              Actifs seulement
            </label>
          </div>
          <div id="notify-players-checkboxes" style="background:var(--dark3);border:1px solid var(--dark4);border-radius:8px;padding:0.75rem;max-height:200px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:0.4rem"></div>
        </div>
        <div class="form-group"><label>Titre</label><input type="text" id="notify-title" placeholder="Ex : Rappel de match…"></div>
        <div class="form-group"><label>Message</label><textarea id="notify-message" rows="4" placeholder="Rédigez votre message…"></textarea></div>
        <div id="notify-error" class="modal-error"></div>
        <div id="notify-success" class="modal-success"></div>
        <button class="btn-modal-save" style="width:100%" onclick="sendNotification()">Envoyer la notification</button>
      </div>
    </div>'''

if old_notify_section in content:
    content = content.replace(old_notify_section, new_notify_section)
    print('Updated notify section')
else:
    print('Notify section not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Updated notify section

Add planned match modal and special score modal
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Add planned match modal before the closing of modals section
old_before_poule_modal = '''<!-- MODAL CRÉER POULE -->'''

new_planned_modal = '''<!-- MODAL PLANNIFIER MATCH -->
<div id="planned-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:540px">
    <h3 id="planned-modal-title">Planifier un <span>Match</span></h3>
    <input type="hidden" id="planned-modal-id">
    <div class="form-row">
      <div class="form-group"><label>Joueur 1</label><select id="planned-p1"><option value="">— Joueur 1 —</option></select></div>
      <div class="form-group"><label>Joueur 2</label><select id="planned-p2"><option value="">— Joueur 2 —</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Phase</label>
        <select id="planned-phase" onchange="onPlannedPhaseChange()">
          <option value="PHASE0">Phase 0</option>
          <option value="PHASE1" selected>Phase 1 — Poules</option>
          <option value="PHASE2">Phase 2 — Finales</option>
        </select>
      </div>
      <div class="form-group" id="planned-round-group" style="display:none">
        <label>Ronde n°</label>
        <input type="number" id="planned-round" min="1" value="1">
      </div>
    </div>
    <div class="form-group">
      <label>Date prévue (optionnelle)</label>
      <input type="date" id="planned-date">
    </div>
    <div class="form-group">
      <label>Malus (optionnel)</label>
      <select id="planned-malus">
        <option value="">— Aucun malus —</option>
      </select>
    </div>
    <div class="form-group" id="planned-malus-target-group" style="display:none">
      <label>Malus attribué à</label>
      <select id="planned-malus-target">
        <option value="1">Joueur 1</option>
        <option value="2">Joueur 2</option>
      </select>
    </div>
    <div class="form-group">
      <label>Note (optionnelle)</label>
      <textarea id="planned-note" rows="2" placeholder="Contexte, remarques…"></textarea>
    </div>
    <div id="planned-modal-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal('planned-modal')">Annuler</button>
      <button class="btn-modal-save" onclick="savePlannedMatch()">Enregistrer</button>
    </div>
  </div>
</div>

<!-- MODAL SAISIR SCORE MATCH PLANIFIÉ -->
<div id="planned-score-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:520px">
    <h3>Renseigner le <span>Score</span></h3>
    <input type="hidden" id="planned-score-id">
    <div id="planned-score-players" style="background:var(--dark3);border:1px solid var(--dark4);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.95rem;color:var(--gray-light)"></div>
    <div class="form-group">
      <label>Date du match</label>
      <input type="date" id="planned-score-date">
    </div>
    <div class="form-group">
      <label>Sets (score joueur 1 – joueur 2)</label>
      <div class="sets-container" id="planned-score-sets"></div>
      <button class="btn-add-set" onclick="addPlannedSetRow()">+ Ajouter un set</button>
    </div>
    <div class="form-group">
      <label>Note (optionnelle)</label>
      <textarea id="planned-score-note" rows="2"></textarea>
    </div>
    <div id="planned-score-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal('planned-score-modal')">Annuler</button>
      <button class="btn-modal-save" onclick="savePlannedScore()">Enregistrer & créer les matchs</button>
    </div>
  </div>
</div>

<!-- MODAL SAISIR SCORE RENCONTRE SPÉCIALE -->
<div id="special-score-modal" class="admin-modal-bg">
  <div class="admin-modal" style="max-width:520px">
    <h3>Renseigner le <span>Score</span></h3>
    <input type="hidden" id="special-score-id">
    <div id="special-score-players" style="background:var(--dark3);border:1px solid var(--dark4);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.95rem;color:var(--gray-light)"></div>
    <div class="form-group">
      <label>Date du match</label>
      <input type="date" id="special-score-date">
    </div>
    <div class="form-group">
      <label>Sets (score joueur 1 – joueur 2)</label>
      <div class="sets-container" id="special-score-sets"></div>
      <button class="btn-add-set" onclick="addSpecialSetRow()">+ Ajouter un set</button>
    </div>
    <div class="form-group">
      <label>Note (optionnelle)</label>
      <textarea id="special-score-note" rows="2"></textarea>
    </div>
    <div id="special-score-error" class="modal-error"></div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal('special-score-modal')">Annuler</button>
      <button class="btn-modal-save" onclick="saveSpecialScore()">Enregistrer & créer les matchs</button>
    </div>
  </div>
</div>

<!-- MODAL CRÉER POULE -->'''

if old_before_poule_modal in content:
    content = content.replace(old_before_poule_modal, new_planned_modal)
    print('Added planned and special score modals')
else:
    print('Poule modal pattern not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Added planned and special score modals

Update logout and login JS functions
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Update adminTab to handle new tabs
old_admin_tab = '''  if (name === 'phase') loadPhase()
  if (name === 'poules') loadPoules()
  if (name === 'publication') loadPendingMatches()
  if (name === 'notifications-list') loadNotificationsList()
  if (name === 'notify' || name === 'special') loadPlayersForNotify()
  if (name === 'history') loadHistory()'''

new_admin_tab = '''  if (name === 'phase') loadPhase()
  if (name === 'poules') loadPoules()
  if (name === 'publication') loadPendingMatches()
  if (name === 'planned') loadPlannedMatches()
  if (name === 'notifications-list') loadNotificationsList()
  if (name === 'notify' || name === 'special') loadPlayersForNotify()
  if (name === 'history') loadHistory()
  if (name === 'refused') loadRefused()'''

if old_admin_tab in content:
    content = content.replace(old_admin_tab, new_admin_tab)
    print('Updated adminTab')
else:
    print('adminTab not found')

# Fix logout function to log the event
old_logout = '''function logout() {
  // JWT stateless : /api/logout supprimé (n'existait pas), on vide le token localement
  localStorage.removeItem('cdr_token'); localStorage.removeItem('cdr_user')
  currentUser = null; pendingNotifications = []; classementLoaded = false
  showAuthOverlay()
}'''

new_logout = '''function logout(reason) {
  // Logger la déconnexion si on a un loginEventId
  const eid = localStorage.getItem('cdr_login_event_id')
  if (eid) {
    try {
      fetch('/api/login?action=logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginEventId: parseInt(eid), reason: reason || 'manual' }),
        keepalive: true,
      })
    } catch(e) {}
    localStorage.removeItem('cdr_login_event_id')
  }
  localStorage.removeItem('cdr_token'); localStorage.removeItem('cdr_user')
  currentUser = null; pendingNotifications = []; classementLoaded = false
  showAuthOverlay()
}'''

if old_logout in content:
    content = content.replace(old_logout, new_logout)
    print('Updated logout function')
else:
    print('Logout not found')

# Update inactivity logout to pass reason
old_inact = "  inactivityTimer = setTimeout(() => logout(), INACTIVITY_MS)"
new_inact = "  inactivityTimer = setTimeout(() => logout('inactivity'), INACTIVITY_MS)"
if old_inact in content:
    content = content.replace(old_inact, new_inact)
    print('Updated inactivity timeout')
else:
    print('Inactivity timer not found')

# Save loginEventId when logging in
old_setuser = '''    localStorage.setItem('cdr_token', data.token)
    localStorage.setItem('cdr_user', JSON.stringify(data.user))
    currentUser = data.user; pendingNotifications = data.pendingNotifications || []'''

new_setuser = '''    localStorage.setItem('cdr_token', data.token)
    localStorage.setItem('cdr_user', JSON.stringify(data.user))
    if (data.loginEventId) localStorage.setItem('cdr_login_event_id', data.loginEventId)
    currentUser = data.user; pendingNotifications = data.pendingNotifications || []'''

if old_setuser in content:
    content = content.replace(old_setuser, new_setuser)
    print('Updated login to save event ID')
else:
    print('login save pattern not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Updated adminTab
Updated logout function
Updated inactivity timeout
Updated login to save event ID

Update special match buttons and notify functions
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Update the special match buttons in pending list to use new unified score modal
old_special_btns = '''          <div class="pending-match-actions">
            <button class="btn-sm btn-match" onclick="openMatchModal(${JSON.stringify(s.player1).replace(/"/g,\'&quot;\')})">Saisir scores (joueur 1)</button>
            <button class="btn-sm btn-edit" onclick="openMatchModal(${JSON.stringify(s.player2).replace(/"/g,\'&quot;\')})">Saisir scores (joueur 2)</button>
          </div>'''

new_special_btns = '''          <div class="pending-match-actions">
            <button class="btn-sm btn-match" onclick="openSpecialScoreModal(${s.id}, ${JSON.stringify(s.player1).replace(/"/g,\'&quot;\')}, ${JSON.stringify(s.player2).replace(/"/g,\'&quot;\')})">Renseigner le score</button>
          </div>'''

if old_special_btns in content:
    content = content.replace(old_special_btns, new_special_btns)
    print('Updated special match buttons')
else:
    print('Special match buttons not found')

# Update notify functions - replace old single-player logic
old_populate_selects = '''function populatePlayerSelects() {
  const opts = allPlayersForNotify.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)} (@${esc(u.username)})</option>`).join('')
  const base = '<option value="">— Sélectionner —</option>' + opts
  ;['notify-player-select','special-player1','special-player2'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = base
  })
}
function quickNotify(userId, name) {
  adminTab('notify', document.querySelector('.admin-tabs .admin-tab:nth-child(6)'))
  document.getElementById('notify-player-select').value = userId
  document.getElementById('notify-title').focus()
}
async function sendNotification() {
  const userId  = document.getElementById('notify-player-select').value
  const title   = document.getElementById('notify-title').value.trim()
  const message = document.getElementById('notify-message').value.trim()
  const errorEl = document.getElementById('notify-error')
  const successEl = document.getElementById('notify-success')
  errorEl.textContent = ''; successEl.textContent = ''
  if (!userId) { errorEl.textContent = 'Sélectionnez un joueur.'; return }
  if (!title)  { errorEl.textContent = 'Titre requis.'; return }
  if (!message){ errorEl.textContent = 'Message requis.'; return }
  const res = await fetch('/api/admin/notifications', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'send', userId: parseInt(userId), title, message }) })
  const data = await res.json()
  if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
  successEl.textContent = '✓ Notification envoyée.'
  document.getElementById('notify-title').value = ''
  document.getElementById('notify-message').value = ''
  document.getElementById('notify-player-select').value = ''
  setTimeout(() => { successEl.textContent = '' }, 3000)
}'''

new_notify_fns = '''function populatePlayerSelects() {
  const opts = allPlayersForNotify.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)} (@${esc(u.username)})</option>`).join('')
  const base = '<option value="">— Sélectionner —</option>' + opts
  ;['special-player1','special-player2'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = base
  })
  renderNotifyPlayerList()
}
function renderNotifyPlayerList() {
  const activeOnly = document.getElementById('notify-active-only').checked
  const players = activeOnly ? allPlayersForNotify.filter(u => u.active) : allPlayersForNotify
  const container = document.getElementById('notify-players-checkboxes')
  if (!container) return
  if (players.length === 0) { container.innerHTML = '<span style="color:var(--gray);font-size:0.83rem">Aucun joueur disponible.</span>'; return }
  container.innerHTML = players.map(u =>
    `<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.83rem;color:var(--gray-light);cursor:pointer;background:var(--dark2);border:1px solid var(--dark4);border-radius:6px;padding:0.25rem 0.6rem;white-space:nowrap">
      <input type="checkbox" class="notify-player-cb" value="${u.id}" style="accent-color:var(--orange);cursor:pointer">
      ${esc(u.firstName)} ${esc(u.lastName)}
    </label>`
  ).join('')
}
function notifySelectAll(select) {
  document.querySelectorAll('.notify-player-cb').forEach(cb => cb.checked = select)
}
function quickNotify(userId, name) {
  adminTab('notify', document.querySelector('[onclick*="notify"]'))
  setTimeout(() => {
    document.querySelectorAll('.notify-player-cb').forEach(cb => {
      cb.checked = parseInt(cb.value) === userId
    })
    document.getElementById('notify-title').focus()
  }, 100)
}
async function sendNotification() {
  const title   = document.getElementById('notify-title').value.trim()
  const message = document.getElementById('notify-message').value.trim()
  const errorEl = document.getElementById('notify-error')
  const successEl = document.getElementById('notify-success')
  errorEl.textContent = ''; successEl.textContent = ''
  const selected = Array.from(document.querySelectorAll('.notify-player-cb:checked')).map(cb => parseInt(cb.value))
  if (selected.length === 0) { errorEl.textContent = 'Sélectionnez au moins un joueur.'; return }
  if (!title)  { errorEl.textContent = 'Titre requis.'; return }
  if (!message){ errorEl.textContent = 'Message requis.'; return }
  const res = await fetch('/api/admin/notifications', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'send', userIds: selected, title, message }) })
  const data = await res.json()
  if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
  successEl.textContent = `✓ Notification envoyée à ${data.count} joueur(s).`
  document.getElementById('notify-title').value = ''
  document.getElementById('notify-message').value = ''
  notifySelectAll(false)
  setTimeout(() => { successEl.textContent = '' }, 3000)
}'''

if old_populate_selects in content:
    content = content.replace(old_populate_selects, new_notify_fns)
    print('Updated notify functions')
else:
    print('Notify functions not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Updated special match buttons
Updated notify functions

Add planned matches JS functions
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Add planned matches JS functions and special score modal functions before the closing script tag
old_close = '''/* ── Actions autres ── */
async function otherAction'''

new_planned_fns = '''/* ── Matchs planifiés ── */
let plannedData = []
let malusList = []
let plannedSetCount = 0
let specialScoreSetCount = 0

async function loadPlannedMatches() {
  const list = document.getElementById('planned-matches-list')
  list.innerHTML = '<div class="admin-empty">Chargement…</div>'
  try {
    const res = await fetch('/api/admin/match', { headers: authHeaders() })
    if (!res.ok) return
    const { planned, activeUsers: au, malusList: ml } = await res.json()
    activeUsers = au || []
    plannedData = planned || []
    malusList = ml || []
    document.getElementById('badge-planned').textContent = plannedData.length
    if (plannedData.length === 0) {
      list.innerHTML = '<div class="admin-empty">Aucun match planifié. Cliquez sur "+ Planifier un match".</div>'
      return
    }
    list.innerHTML = plannedData.map(pm => {
      const p1 = pm.player1, p2 = pm.player2
      const malusText = pm.malus ? `♡ <strong>${esc(pm.malus)}</strong> → ${pm.malusTarget === 1 ? esc(p1.firstName) : esc(p2.firstName)}` : 'Aucun malus'
      return `<div class="pending-match-card">
        <div class="pending-match-info">
          <div class="pending-match-player">${esc(p1.firstName)} ${esc(p1.lastName)} <span class="player-level level-${p1.category||'NC'}">${p1.category||'NC'}</span> <span style="color:var(--gray)">vs</span> ${esc(p2.firstName)} ${esc(p2.lastName)} <span class="player-level level-${p2.category||'NC'}">${p2.category||'NC'}</span></div>
          <div class="pending-match-detail">${pm.scheduledDate ? '📅 ' + fmtDateOnly(pm.scheduledDate) : '📅 Date non définie'} · ${pm.phase === 'PHASE0' ? 'Phase 0' : pm.phase === 'PHASE1' ? 'Phase 1' : 'Phase 2 R'+(pm.roundNumber||'?')}</div>
          <div style="font-size:0.82rem;color:var(--gray);margin-top:0.2rem">🎯 ${malusText}</div>
          ${pm.note ? `<div style="font-size:0.82rem;color:var(--gray);margin-top:0.2rem;font-style:italic">📝 ${esc(pm.note)}</div>` : ''}
        </div>
        <div class="pending-match-actions">
          <button class="btn-sm btn-match" onclick="openPlannedScoreModal(${pm.id})">Renseigner le score</button>
          <button class="btn-sm btn-edit" onclick="openPlannedEditModal(${pm.id})">Modifier</button>
          <button class="btn-sm btn-danger" onclick="deletePlannedMatch(${pm.id})">Supprimer</button>
        </div>
      </div>`
    }).join('')
  } catch(e) { console.error('[loadPlannedMatches]', e) }
}

function populatePlannedPlayerSelects() {
  const opts = '<option value="">— Sélectionner —</option>' +
    activeUsers.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)} (@${esc(u.username)}) — ${u.category||'NC'}</option>`).join('')
  ;['planned-p1','planned-p2'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = opts
  })
}

function populateMalusSelect() {
  const sel = document.getElementById('planned-malus')
  if (!sel) return
  sel.innerHTML = '<option value="">— Aucun malus —</option>' +
    malusList.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
  sel.onchange = () => {
    document.getElementById('planned-malus-target-group').style.display = sel.value ? 'block' : 'none'
  }
}

function onPlannedPhaseChange() {
  document.getElementById('planned-round-group').style.display =
    document.getElementById('planned-phase').value === 'PHASE2' ? 'block' : 'none'
}

function openPlannedAddModal() {
  if (activeUsers.length === 0) { loadPendingMatches().then(() => openPlannedAddModal()); return }
  document.getElementById('planned-modal-title').innerHTML = 'Planifier un <span>Match</span>'
  document.getElementById('planned-modal-id').value = ''
  populatePlannedPlayerSelects()
  populateMalusSelect()
  document.getElementById('planned-p1').value = ''
  document.getElementById('planned-p2').value = ''
  document.getElementById('planned-phase').value = 'PHASE1'
  document.getElementById('planned-round-group').style.display = 'none'
  document.getElementById('planned-round').value = '1'
  document.getElementById('planned-date').value = ''
  document.getElementById('planned-malus').value = ''
  document.getElementById('planned-malus-target-group').style.display = 'none'
  document.getElementById('planned-note').value = ''
  document.getElementById('planned-modal-error').textContent = ''
  document.getElementById('planned-modal').classList.add('open')
}

function openPlannedEditModal(pmid) {
  const pm = plannedData.find(p => p.id === pmid)
  if (!pm) return
  populatePlannedPlayerSelects()
  populateMalusSelect()
  document.getElementById('planned-modal-title').innerHTML = 'Modifier le <span>Match planifié</span>'
  document.getElementById('planned-modal-id').value = pmid
  document.getElementById('planned-p1').value = pm.player1Id
  document.getElementById('planned-p1').disabled = true
  document.getElementById('planned-p2').value = pm.player2Id
  document.getElementById('planned-p2').disabled = true
  document.getElementById('planned-phase').value = pm.phase || 'PHASE1'
  document.getElementById('planned-round-group').style.display = pm.phase === 'PHASE2' ? 'block' : 'none'
  document.getElementById('planned-round').value = pm.roundNumber || 1
  document.getElementById('planned-date').value = pm.scheduledDate ? pm.scheduledDate.slice(0,10) : ''
  document.getElementById('planned-malus').value = pm.malus || ''
  document.getElementById('planned-malus-target-group').style.display = pm.malus ? 'block' : 'none'
  document.getElementById('planned-malus-target').value = pm.malusTarget || 1
  document.getElementById('planned-note').value = pm.note || ''
  document.getElementById('planned-modal-error').textContent = ''
  document.getElementById('planned-modal').classList.add('open')
}

async function savePlannedMatch() {
  const pmid = document.getElementById('planned-modal-id').value
  const errorEl = document.getElementById('planned-modal-error')
  const p1 = document.getElementById('planned-p1').value
  const p2 = document.getElementById('planned-p2').value
  const phase = document.getElementById('planned-phase').value
  const round = document.getElementById('planned-round').value
  const date = document.getElementById('planned-date').value
  const malus = document.getElementById('planned-malus').value
  const malusTarget = document.getElementById('planned-malus-target').value
  const note = document.getElementById('planned-note').value.trim()
  errorEl.textContent = ''
  if (!pmid && (!p1 || !p2)) { errorEl.textContent = 'Sélectionnez les deux joueurs.'; return }
  if (!pmid && p1 === p2) { errorEl.textContent = 'Les joueurs doivent être différents.'; return }
  try {
    let body
    if (pmid) {
      body = { action: 'planned_edit', plannedMatchId: parseInt(pmid), scheduledDate: date||null, malus: malus||null, malusTarget: malus ? parseInt(malusTarget) : null, note: note||null, phase, round: phase==='PHASE2'?parseInt(round):null }
    } else {
      body = { action: 'planned_add', player1Id: parseInt(p1), player2Id: parseInt(p2), scheduledDate: date||null, malus: malus||null, malusTarget: malus ? parseInt(malusTarget) : null, note: note||null, phase, round: phase==='PHASE2'?parseInt(round):null }
    }
    const res = await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
    // Reset disabled state
    document.getElementById('planned-p1').disabled = false
    document.getElementById('planned-p2').disabled = false
    closeModal('planned-modal')
    await loadPlannedMatches()
  } catch(e) { errorEl.textContent = 'Erreur réseau.' }
}

async function deletePlannedMatch(pmid) {
  if (!confirm('Supprimer ce match planifié ?')) return
  await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'planned_delete', plannedMatchId: pmid }) })
  await loadPlannedMatches()
}

function addPlannedSetRow() {
  plannedSetCount++
  const num = plannedSetCount
  const row = document.createElement('div')
  row.className = 'set-row'; row.id = 'pset-row-' + num
  row.innerHTML = `<label>Set ${num}</label>
    <input type="number" id="pset-p-${num}" min="0" max="99" value="0">
    <span class="set-sep">–</span>
    <input type="number" id="pset-o-${num}" min="0" max="99" value="0">
    <button class="btn-remove-set" onclick="removePSetRow(${num})">✕</button>`
  document.getElementById('planned-score-sets').appendChild(row)
}
function removePSetRow(num) {
  const row = document.getElementById('pset-row-' + num)
  if (row) row.remove()
  plannedSetCount = document.querySelectorAll('#planned-score-sets .set-row').length
  document.querySelectorAll('#planned-score-sets .set-row').forEach((r,i) => r.querySelector('label').textContent = 'Set '+(i+1))
}

function openPlannedScoreModal(pmid) {
  const pm = plannedData.find(p => p.id === pmid)
  if (!pm) return
  document.getElementById('planned-score-id').value = pmid
  document.getElementById('planned-score-players').innerHTML =
    `🏸 <strong>${esc(pm.player1.firstName)} ${esc(pm.player1.lastName)}</strong> vs <strong>${esc(pm.player2.firstName)} ${esc(pm.player2.lastName)}</strong>${pm.malus ? `<br>♡ Malus : ${esc(pm.malus)} → ${pm.malusTarget===1?esc(pm.player1.firstName):esc(pm.player2.firstName)}` : ''}`
  document.getElementById('planned-score-date').value = pm.scheduledDate ? pm.scheduledDate.slice(0,10) : new Date().toISOString().slice(0,10)
  document.getElementById('planned-score-note').value = pm.note || ''
  document.getElementById('planned-score-error').textContent = ''
  document.getElementById('planned-score-sets').innerHTML = ''
  plannedSetCount = 0
  addPlannedSetRow()
  document.getElementById('planned-score-modal').classList.add('open')
}

async function savePlannedScore() {
  const pmid = parseInt(document.getElementById('planned-score-id').value, 10)
  const date = document.getElementById('planned-score-date').value
  const note = document.getElementById('planned-score-note').value.trim()
  const errorEl = document.getElementById('planned-score-error')
  errorEl.textContent = ''
  if (!date) { errorEl.textContent = 'Date requise.'; return }
  const setRows = document.querySelectorAll('#planned-score-sets .set-row')
  if (setRows.length === 0) { errorEl.textContent = 'Ajoutez au moins un set.'; return }
  const sets = []
  setRows.forEach((row, i) => {
    const ps = parseInt(row.querySelector('input:nth-of-type(1)').value, 10)
    const os = parseInt(row.querySelector('input:nth-of-type(2)').value, 10)
    sets.push({ setNumber: i+1, playerScore: ps, opponentScore: os })
  })
  try {
    const res = await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'planned_convert', plannedMatchId: pmid, matchDate: date, note: note||null, sets }) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
    closeModal('planned-score-modal')
    await loadPlannedMatches()
    await loadPendingMatches()
  } catch(e) { errorEl.textContent = 'Erreur réseau.' }
}

/* ── Saisie score rencontre spéciale ── */
function addSpecialSetRow() {
  specialScoreSetCount++
  const num = specialScoreSetCount
  const row = document.createElement('div')
  row.className = 'set-row'; row.id = 'sset-row-' + num
  row.innerHTML = `<label>Set ${num}</label>
    <input type="number" id="sset-p-${num}" min="0" max="99" value="0">
    <span class="set-sep">–</span>
    <input type="number" id="sset-o-${num}" min="0" max="99" value="0">
    <button class="btn-remove-set" onclick="removeSSRow(${num})">✕</button>`
  document.getElementById('special-score-sets').appendChild(row)
}
function removeSSRow(num) {
  const row = document.getElementById('sset-row-' + num)
  if (row) row.remove()
  specialScoreSetCount = document.querySelectorAll('#special-score-sets .set-row').length
  document.querySelectorAll('#special-score-sets .set-row').forEach((r,i) => r.querySelector('label').textContent = 'Set '+(i+1))
}

function openSpecialScoreModal(smid, p1, p2) {
  document.getElementById('special-score-id').value = smid
  document.getElementById('special-score-players').innerHTML =
    `🏸 <strong>${esc(p1.firstName)} ${esc(p1.lastName)}</strong> <span style="color:var(--gray)">vs</span> <strong>${esc(p2.firstName)} ${esc(p2.lastName)}</strong>`
  document.getElementById('special-score-date').value = new Date().toISOString().slice(0,10)
  document.getElementById('special-score-note').value = ''
  document.getElementById('special-score-error').textContent = ''
  document.getElementById('special-score-sets').innerHTML = ''
  specialScoreSetCount = 0
  addSpecialSetRow()
  document.getElementById('special-score-modal').classList.add('open')
}

async function saveSpecialScore() {
  const smid = parseInt(document.getElementById('special-score-id').value, 10)
  const date = document.getElementById('special-score-date').value
  const note = document.getElementById('special-score-note').value.trim()
  const errorEl = document.getElementById('special-score-error')
  errorEl.textContent = ''
  if (!date) { errorEl.textContent = 'Date requise.'; return }
  const setRows = document.querySelectorAll('#special-score-sets .set-row')
  if (setRows.length === 0) { errorEl.textContent = 'Ajoutez au moins un set.'; return }
  const sets = []
  setRows.forEach((row, i) => {
    const ps = parseInt(row.querySelector('input:nth-of-type(1)').value, 10)
    const os = parseInt(row.querySelector('input:nth-of-type(2)').value, 10)
    sets.push({ setNumber: i+1, playerScore: ps, opponentScore: os })
  })
  try {
    const res = await fetch('/api/admin/match', { method:'POST', headers: authHeaders(), body: JSON.stringify({ action:'add_from_special', specialMatchId: smid, matchDate: date, note: note||null, sets }) })
    const data = await res.json()
    if (!res.ok) { errorEl.textContent = data.error||'Erreur.'; return }
    closeModal('special-score-modal')
    await loadPendingMatches()
  } catch(e) { errorEl.textContent = 'Erreur réseau.' }
}

/* ── Inscriptions refusées ── */
async function loadRefused() {
  const tbl = document.getElementById('tbl-refused')
  const empty = document.getElementById('refused-empty')
  try {
    const res = await fetch('/api/admin/action?refused=1', { headers: authHeaders() })
    if (!res.ok) return
    const { refused } = await res.json()
    if (refused.length === 0) {
      tbl.innerHTML = ''; empty.style.display = 'block'; return
    }
    empty.style.display = 'none'
    tbl.innerHTML = refused.map(r => `
      <tr>
        <td>${esc(r.firstName)}</td>
        <td>${esc(r.lastName)}</td>
        <td>${esc(r.phone)}</td>
        <td style="color:var(--gray);font-size:0.82rem">${fmtDate(r.refusedAt)}</td>
      </tr>`).join('')
  } catch(e) { console.error('[loadRefused]', e) }
}

/* ── Actions autres ── */
async function otherAction'''

if '/* ── Actions autres ── */\nasync function otherAction' in content:
    content = content.replace('/* ── Actions autres ── */\nasync function otherAction', new_planned_fns)
    print('Added planned/special/refused JS functions')
else:
    print('Target not found for JS functions')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Added planned/special/refused JS functions

Update modal listeners to include new modals
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Add CSS for planned-modal and fix planned-modal close handlers
old_modal_listeners = ''';['create-poule-modal','create-group-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) { if (e.target===this) closeModal(id) })
})'''

new_modal_listeners = ''';['create-poule-modal','create-group-modal','planned-modal','planned-score-modal','special-score-modal'].forEach(id => {
  const el = document.getElementById(id)
  if (el) el.addEventListener('click', function(e) { if (e.target===this) closeModal(id) })
})'''

if old_modal_listeners in content:
    content = content.replace(old_modal_listeners, new_modal_listeners)
    print('Updated modal listeners')
else:
    print('Modal listeners not found')

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Updated modal listeners

Check live matches approach
bash

python3 << 'PYEOF'
with open('/home/claude/index.html', 'r') as f:
    content = f.read()

# Fix the matches.js live display issue:
# When snapshot is active, player detail modal fetches /api/matches?userId=X which is always live
# This is correct. But we need to ensure matches count in classement table always shows live matches.
# The current renderRankingTable shows "J" (played count) from the snapshot - that's the frozen count.
# We need to always show live match count. This requires a different approach:
# For the classement page, the snapshot stores frozen ranking POSITIONS but we should always show live match counts.
# This is complex - the snapshot stores the full player stats.
# 
# The user wants: "mes matchs deviennent visibles lorsqu'il est publié par l'admin, 
# mes points me sont attribués, mais je ne bouge pas dans le classement avant que le classement ne soit défigé"
#
# So: when snapshot exists, use snapshot for POSITIONS (rank order), but update match counts/points from live data.
# But the snapshot already has the right positions frozen.
# The simpler interpretation: matches are always shown in player detail (live), 
# ranking TABLE shows frozen positions but live match counts.
#
# The current code: when snapshot exists, it returns snapshot.players which has frozen stats.
# What user wants: show live stats in the table but keep the ORDERING frozen.
# 
# This requires backend change in matches.js to merge snapshot order with live stats.
# Let me update matches.js to do this properly.

print("Backend change needed for live stats with frozen positions - will update matches.js")

# For now the user detail (showPlayerDetail) already always shows live data because it fetches 
# /api/matches?userId=X which doesn't use snapshot. That part is correct.

# The main classement table ordering - we need to update the backend.
# Let's read the current content for matches.js reference and modify the output.

with open('/home/claude/index.html', 'w') as f:
    f.write(content)
PYEOF
Output

Backend change needed for live stats with frozen positions - will update matches.js
Done

19:33

Ran 2 commands
Ran 2 commands

Check which file handles classement
bash

python3 << 'PYEOF'
# Update matches.js to serve live stats + frozen positions
with open('/home/claude/match.js', 'r') as f:
    content = f.read()

# The matches.js GET handler for the public classement already has the snapshot logic.
# We need to update /api/matches (the public one, not admin) to:
# When snapshot exists: use snapshot for RANK ORDER but merge with live stats for match counts/points.
# 
# Actually re-reading the user request:
# "Les matchs faits par chaque joueur dans le classement général doit toujours être affiché en Live"
# "mes points me sont attribués, mais je ne bouge pas dans le classement"
# 
# So: stats (played, wins, points) are live. POSITION in table is frozen.
# This means: we sort by snapshot order, but display live stats.
# 
# We need to update the file at /home/claude/match.js - but this is api/admin/match.js
# The public classement is api/matches.js - we need a separate update.
print("matches.js (public) is a different file - need to update /mnt/user-data/uploads/matches.js")
PYEOF
Output

matches.js (public) is a different file - need to update /mnt/user-data/uploads/matches.js

Write updated matches.js with live stats + frozen positions
bash

cat > /home/claude/matches.js << 'EOF'
// api/matches.js
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

if (!global._prisma) global._prisma = new PrismaClient()
const prisma = global._prisma

const ADMIN_USERNAMES = ['admin', 'root']

function requireAuth(req, res) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Non authentifié.' }); return null }
  try { return jwt.verify(token, process.env.JWT_SECRET) }
  catch { res.status(401).json({ error: 'Session expirée ou invalide.' }); return null }
}

function computeStats(matches) {
  let played = 0, wins = 0, losses = 0, setDiff = 0
  for (const m of matches) {
    const pw = m.sets.filter(s => s.playerScore > s.opponentScore).length
    const ow = m.sets.filter(s => s.opponentScore > s.playerScore).length
    played++
    if (pw > ow) wins++; else losses++
    setDiff += pw - ow
  }
  const points = wins * 3 + losses * 1
  return { played, wins, losses, setDiff, points }
}

// Ordre : victoires DESC, matchs joués ASC, points DESC, createdAt ASC
function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.played !== b.played) return a.played - b.played
    if (b.points !== a.points) return b.points - a.points
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  // Rencontres en cours (public)
  if (req.query.public === '1') {
    try {
      const specials = await prisma.specialMatch.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
      })
      const enriched = await Promise.all(specials.map(async sm => {
        const [p1, p2] = await Promise.all([
          prisma.user.findUnique({ where: { id: sm.player1Id }, select: { id: true, firstName: true, lastName: true, username: true } }),
          prisma.user.findUnique({ where: { id: sm.player2Id }, select: { id: true, firstName: true, lastName: true, username: true } }),
        ])
        return { ...sm, player1: p1, player2: p2 }
      }))
      return res.status(200).json({ specials: enriched })
    } catch (err) {
      console.error('[matches public]', err)
      return res.status(500).json({ error: 'Erreur serveur.' })
    }
  }

  const auth = requireAuth(req, res)
  if (!auth) return

  const isAdmin = auth.role === 'ADMIN' || ADMIN_USERNAMES.includes((auth.username || '').toLowerCase())

  try {
    const { userId } = req.query || {}

    // Requête joueur spécifique — toujours live
    if (userId) {
      const uid = parseInt(userId, 10)
      if (isNaN(uid)) return res.status(400).json({ error: 'userId invalide.' })
      const user = await prisma.user.findUnique({
        where: { id: uid },
        select: {
          id: true, username: true, firstName: true, lastName: true,
          category: true, accepted: true, banned: true, active: true, createdAt: true,
          matches: {
            where: { published: true },
            orderBy: { matchDate: 'desc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      })
      if (!user) return res.status(404).json({ error: 'Joueur introuvable.' })
      return res.status(200).json({
        user: {
          id: user.id, username: user.username,
          firstName: user.firstName, lastName: user.lastName,
          category: user.category, active: user.active,
          ...computeStats(user.matches),
          matches: user.matches,
        },
      })
    }

    // Liste complète
    const state = await prisma.tournamentState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, currentPhase: 'PHASE0', currentRound: null },
    })

    // Toujours calculer les stats LIVE depuis la DB
    const users = await prisma.user.findMany({
      where: {
        accepted: true,
        banned: false,
        active: true,
        username: { notIn: ADMIN_USERNAMES },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        category: true, createdAt: true,
        matches: {
          where: { published: true },
          orderBy: { matchDate: 'desc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
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

    // Statistiques live pour chaque joueur
    const livePlayers = users.map(u => ({
      id: u.id, username: u.username,
      firstName: u.firstName, lastName: u.lastName,
      category: u.category, createdAt: u.createdAt,
      pouleId: userPouleMap[u.id] || null,
      ...computeStats(u.matches),
      matches: u.matches,
    }))

    // Si snapshot actif : utiliser l'ordre figé mais les stats live
    let orderedPlayers
    if (state.rankingSnapshot) {
      try {
        const snapshot = JSON.parse(state.rankingSnapshot)
        const frozenOrder = snapshot.players || snapshot

        // Réordonner selon le snapshot (position figée), mais stats live
        const liveMap = {}
        for (const p of livePlayers) liveMap[p.id] = p

        // Joueurs dans l'ordre du snapshot avec stats live
        const ordered = frozenOrder
          .map(fp => liveMap[fp.id] || { ...fp })
          .filter(Boolean)

        // Joueurs nouveaux (pas dans le snapshot) → en fin
        const frozenIds = new Set(frozenOrder.map(p => p.id))
        const newPlayers = livePlayers.filter(p => !frozenIds.has(p.id))

        orderedPlayers = [...ordered, ...newPlayers]
      } catch {
        orderedPlayers = sortPlayers(livePlayers)
      }
    } else {
      orderedPlayers = sortPlayers(livePlayers)
    }

    const poulesWithStats = poules.map(p => {
      const memberIds = new Set(p.members.map(m => m.userId))
      const poulePlayers = livePlayers.filter(pl => memberIds.has(pl.id))
      return {
        id: p.id, name: p.name, phase: p.phase,
        totalPoints: poulePlayers.reduce((a, pl) => a + pl.points, 0),
        totalWins:   poulePlayers.reduce((a, pl) => a + pl.wins, 0),
        members: sortPlayers(poulePlayers).map(pl => ({
          id: pl.id, firstName: pl.firstName, lastName: pl.lastName,
          username: pl.username, category: pl.category,
          points: pl.points, wins: pl.wins, losses: pl.losses,
          played: pl.played, setDiff: pl.setDiff,
        })),
      }
    })

    const response = {
      phase: state.currentPhase,
      round: state.currentRound,
      players: orderedPlayers,
      poules: poulesWithStats,
      phase2Groups,
      rankingFrozen: !!state.rankingSnapshot,
    }
    if (isAdmin) response.fromSnapshot = !!state.rankingSnapshot

    return res.status(200).json(response)
  } catch (err) {
    console.error('[matches]', err)
    return res.status(500).json({ error: 'Erreur serveur.' })
  }
}
EOF
echo "matches.js done"
Output

matches.js done
Done




