/*
  Migration corrigée pour conserver les données existantes
*/

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('PHASE0', 'PHASE1', 'PHASE2');

-- AlterEnum
ALTER TYPE "Category" ADD VALUE 'NC';

-- DropIndex
DROP INDEX "Phase2GroupMember_userId_key";

-- DropIndex
DROP INDEX "PouleMember_userId_key";

-- AlterTable
ALTER TABLE "LoginEvent"
ADD COLUMN "logoutAt" TIMESTAMP(3);

-- =====================================================
-- MATCH
-- =====================================================

ALTER TABLE "Match"
ALTER COLUMN "phase" DROP DEFAULT;

ALTER TABLE "Match"
ALTER COLUMN "phase"
TYPE "Phase"
USING ("phase"::text::"Phase");

-- =====================================================
-- POULE
-- =====================================================

ALTER TABLE "Poule"
ALTER COLUMN "phase" DROP DEFAULT;

ALTER TABLE "Poule"
ALTER COLUMN "phase"
TYPE "Phase"
USING ("phase"::text::"Phase");

ALTER TABLE "Poule"
ALTER COLUMN "phase"
SET DEFAULT 'PHASE1'::"Phase";

-- =====================================================
-- TOURNAMENTSTATE
-- =====================================================


ALTER TABLE "TournamentState"
ALTER COLUMN "currentPhase" DROP DEFAULT;

ALTER TABLE "TournamentState"
ALTER COLUMN "currentPhase"
TYPE "Phase"
USING ("currentPhase"::text::"Phase");

ALTER TABLE "TournamentState"
ALTER COLUMN "currentPhase"
SET DEFAULT 'PHASE0'::"Phase";

-- =====================================================
-- USER
-- =====================================================

ALTER TABLE "User"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "forceLogout" BOOLEAN NOT NULL DEFAULT false;

-- =====================================================
-- INDEXES
-- =====================================================

CREATE UNIQUE INDEX "Phase2GroupMember_groupId_userId_key"
ON "Phase2GroupMember"("groupId", "userId");

CREATE UNIQUE INDEX "PouleMember_pouleId_userId_key"
ON "PouleMember"("pouleId", "userId");

-- =====================================================
-- FKs
-- =====================================================

ALTER TABLE "SpecialMatch"
ADD CONSTRAINT "SpecialMatch_player1Id_fkey"
FOREIGN KEY ("player1Id")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "SpecialMatch"
ADD CONSTRAINT "SpecialMatch_player2Id_fkey"
FOREIGN KEY ("player2Id")
REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;