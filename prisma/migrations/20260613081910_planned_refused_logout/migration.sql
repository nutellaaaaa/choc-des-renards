-- AlterTable
ALTER TABLE "LoginEvent" ADD COLUMN     "logoutReason" TEXT;

-- CreateTable
CREATE TABLE "RefusedRegistration" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "refusedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefusedRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedMatch" (
    "id" SERIAL NOT NULL,
    "player1Id" INTEGER NOT NULL,
    "player2Id" INTEGER NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "malus" TEXT,
    "malusTarget" INTEGER,
    "note" TEXT,
    "phase" "Phase" NOT NULL DEFAULT 'PHASE1',
    "roundNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedMatch_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PlannedMatch" ADD CONSTRAINT "PlannedMatch_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedMatch" ADD CONSTRAINT "PlannedMatch_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
