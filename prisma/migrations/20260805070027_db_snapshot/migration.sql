-- CreateTable
CREATE TABLE "DataVersion" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "DataVersion_pkey" PRIMARY KEY ("id")
);
