/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `TournamentState` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "type" DROP DEFAULT;

-- AlterTable
CREATE SEQUENCE tournamentstate_id_seq;
ALTER TABLE "TournamentState" DROP COLUMN "updatedAt",
ADD COLUMN     "siteSuspended" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "id" SET DEFAULT nextval('tournamentstate_id_seq');
ALTER SEQUENCE tournamentstate_id_seq OWNED BY "TournamentState"."id";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "category" SET DEFAULT 'NC';
