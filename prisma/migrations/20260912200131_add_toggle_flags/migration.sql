-- AlterTable
ALTER TABLE "TournamentState" ADD COLUMN     "appPopupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "faqVotesEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "forgotUsernameEnabled" BOOLEAN NOT NULL DEFAULT true;
