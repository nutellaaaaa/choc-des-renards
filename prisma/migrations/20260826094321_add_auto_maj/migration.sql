-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenSiteUpdateId" INTEGER;

-- CreateTable
CREATE TABLE "SiteUpdate" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "instant" BOOLEAN NOT NULL DEFAULT true,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteUpdateItem" (
    "id" SERIAL NOT NULL,
    "updateId" INTEGER NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SiteUpdateItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SiteUpdateItem" ADD CONSTRAINT "SiteUpdateItem_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "SiteUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
