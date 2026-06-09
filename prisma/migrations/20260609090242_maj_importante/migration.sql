-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialMatchId" INTEGER;

-- AlterTable
ALTER TABLE "TournamentState" ADD COLUMN     "rankingSnapshot" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'message',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "opponentName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "reason" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialMatch" (
    "id" SERIAL NOT NULL,
    "player1Id" INTEGER NOT NULL,
    "player2Id" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PHASE1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PouleMember" (
    "id" SERIAL NOT NULL,
    "pouleId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "PouleMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase2Group" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Phase2Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase2GroupMember" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Phase2GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PouleMember_userId_key" ON "PouleMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Phase2GroupMember_userId_key" ON "Phase2GroupMember"("userId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_specialMatchId_fkey" FOREIGN KEY ("specialMatchId") REFERENCES "SpecialMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PouleMember" ADD CONSTRAINT "PouleMember_pouleId_fkey" FOREIGN KEY ("pouleId") REFERENCES "Poule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PouleMember" ADD CONSTRAINT "PouleMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase2GroupMember" ADD CONSTRAINT "Phase2GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Phase2Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase2GroupMember" ADD CONSTRAINT "Phase2GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
