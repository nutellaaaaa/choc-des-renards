-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" SERIAL NOT NULL,
    "day" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "standalone" BOOLEAN NOT NULL DEFAULT false,
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "pageViews" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageHitDaily" (
    "day" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PageHitDaily_pkey" PRIMARY KEY ("day","page")
);

-- CreateIndex
CREATE INDEX "SiteVisit_day_idx" ON "SiteVisit"("day");

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisit_day_visitorHash_key" ON "SiteVisit"("day", "visitorHash");
