-- CreateTable
CREATE TABLE "MatchChat" (
    "id" SERIAL NOT NULL,
    "plannedMatchId" INTEGER,
    "specialMatchId" INTEGER,
    "player1Id" INTEGER NOT NULL,
    "player2Id" INTEGER NOT NULL,
    "phase" "Phase" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchChatMessage" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "content" TEXT NOT NULL,
    "isAuto" BOOLEAN NOT NULL DEFAULT false,
    "readBy" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchChat_plannedMatchId_key" ON "MatchChat"("plannedMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchChat_specialMatchId_key" ON "MatchChat"("specialMatchId");

-- AddForeignKey
ALTER TABLE "MatchChat" ADD CONSTRAINT "MatchChat_plannedMatchId_fkey" FOREIGN KEY ("plannedMatchId") REFERENCES "PlannedMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchChat" ADD CONSTRAINT "MatchChat_specialMatchId_fkey" FOREIGN KEY ("specialMatchId") REFERENCES "SpecialMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchChat" ADD CONSTRAINT "MatchChat_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchChat" ADD CONSTRAINT "MatchChat_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchChatMessage" ADD CONSTRAINT "MatchChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "MatchChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchChatMessage" ADD CONSTRAINT "MatchChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
