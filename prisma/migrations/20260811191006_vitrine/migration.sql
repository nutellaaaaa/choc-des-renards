-- CreateTable
CREATE TABLE "Medal" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Medal_username_idx" ON "Medal"("username");

-- CreateIndex
CREATE INDEX "Medal_seasonYear_idx" ON "Medal"("seasonYear");

-- CreateIndex
CREATE INDEX "Medal_rarity_idx" ON "Medal"("rarity");
