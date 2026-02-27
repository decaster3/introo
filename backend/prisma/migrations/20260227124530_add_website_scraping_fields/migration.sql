-- DropIndex
DROP INDEX "companies_embedding_idx";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "scrapedAt" TIMESTAMP(3),
ADD COLUMN     "websiteSummary" TEXT;
