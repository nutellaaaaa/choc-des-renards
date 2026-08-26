-- CreateTable
CREATE TABLE "CharteArticle" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharteArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharteArticleItem" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "subtitle" TEXT,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CharteArticleItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CharteArticleItem" ADD CONSTRAINT "CharteArticleItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CharteArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
