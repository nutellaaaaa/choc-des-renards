-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "reply" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "licenseNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SiteText" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteText_pkey" PRIMARY KEY ("key")
);
