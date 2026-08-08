-- ═══════════════════════════════════════════════════════════════
-- Migration additive — CDR nouvelles fonctionnalités
-- Appliquer une seule fois en production via psql ou Neon SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. FAQ : visibilité publique des articles
ALTER TABLE "FaqTopic" ADD COLUMN IF NOT EXISTS "published" BOOLEAN NOT NULL DEFAULT false;

-- 2. TournamentState : nouvelles colonnes de configuration
ALTER TABLE "TournamentState"
  ADD COLUMN IF NOT EXISTS "autoRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "hiddenTabs"           TEXT     NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "malusConfig"          TEXT     NOT NULL DEFAULT '[]';

-- 3. Register : détection pseudo dupliqué (log dans AdminAlert)
-- 4. Login échoué admin (log dans AdminAlert)
-- → nouvelle table AdminAlert
CREATE TABLE IF NOT EXISTS "AdminAlert" (
  "id"        SERIAL PRIMARY KEY,
  "type"      TEXT        NOT NULL,  -- 'score_missing' | 'login_failed_admin' | 'duplicate_username'
  "message"   TEXT        NOT NULL,
  "meta"      JSONB,
  "read"      BOOLEAN     NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
