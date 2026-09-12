-- AlterTable
ALTER TABLE "TournamentState" ADD COLUMN     "appPopupDismissDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "appPopupMaxShows" INTEGER,
ADD COLUMN     "appPopupShowDelaySec" INTEGER NOT NULL DEFAULT 4;
