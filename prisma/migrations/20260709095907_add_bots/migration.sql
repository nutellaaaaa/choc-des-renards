-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BotTask" (
    "id" SERIAL NOT NULL,
    "botId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTask_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BotTask" ADD CONSTRAINT "BotTask_botId_fkey" FOREIGN KEY ("botId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
