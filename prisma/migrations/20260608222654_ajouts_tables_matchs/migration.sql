-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "roundNumber" INTEGER,
    "matchDate" TIMESTAMP(3) NOT NULL,
    "opponentFirstName" TEXT NOT NULL,
    "opponentLastName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSet" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "playerScore" INTEGER NOT NULL,
    "opponentScore" INTEGER NOT NULL,

    CONSTRAINT "MatchSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currentPhase" TEXT NOT NULL DEFAULT 'PHASE1',
    "currentRound" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentState_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSet" ADD CONSTRAINT "MatchSet_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
