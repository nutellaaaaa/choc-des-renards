-- AlterTable
ALTER TABLE "PageHitDaily" ADD COLUMN     "seconds" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "seconds" INTEGER NOT NULL DEFAULT 0;
