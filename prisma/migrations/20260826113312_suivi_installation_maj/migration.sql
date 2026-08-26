-- CreateTable
CREATE TABLE "SiteUpdateInstall" (
    "id" SERIAL NOT NULL,
    "updateId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteUpdateInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteUpdateInstall_updateId_idx" ON "SiteUpdateInstall"("updateId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteUpdateInstall_updateId_userId_key" ON "SiteUpdateInstall"("updateId", "userId");

-- AddForeignKey
ALTER TABLE "SiteUpdateInstall" ADD CONSTRAINT "SiteUpdateInstall_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "SiteUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteUpdateInstall" ADD CONSTRAINT "SiteUpdateInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
