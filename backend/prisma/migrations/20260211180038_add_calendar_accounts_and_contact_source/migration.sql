-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "sourceAccountId" TEXT;

-- CreateTable
CREATE TABLE "calendar_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "googleAccessToken" TEXT NOT NULL,
    "googleRefreshToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_accounts_userId_idx" ON "calendar_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_accounts_userId_email_key" ON "calendar_accounts"("userId", "email");

-- CreateIndex
CREATE INDEX "contacts_sourceAccountId_idx" ON "contacts"("sourceAccountId");

-- AddForeignKey
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "calendar_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
