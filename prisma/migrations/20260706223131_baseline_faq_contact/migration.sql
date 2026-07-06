-- Baseline manuel : ces tables existent déjà réellement dans la base (créées via
-- `prisma db push` à l'époque, jamais enregistrées comme migration). Ce fichier ne sera
-- jamais exécuté (on le marque "applied" directement) — il sert de documentation et de
-- point de référence pour les futurs `prisma migrate diff`.

-- CreateTable
CREATE TABLE "FaqTopic" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "usefulCount" INTEGER NOT NULL DEFAULT 0,
    "notUsefulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqItem" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqView" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqVote" (
    "id" SERIAL NOT NULL,
    "topicId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "useful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "nature" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "treated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaqVote_topicId_userId_key" ON "FaqVote"("topicId", "userId");

-- AddForeignKey
ALTER TABLE "FaqItem" ADD CONSTRAINT "FaqItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "FaqTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqView" ADD CONSTRAINT "FaqView_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "FaqTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqView" ADD CONSTRAINT "FaqView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqVote" ADD CONSTRAINT "FaqVote_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "FaqTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqVote" ADD CONSTRAINT "FaqVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
