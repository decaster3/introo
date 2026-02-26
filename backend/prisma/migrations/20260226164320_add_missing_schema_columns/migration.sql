-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "annualRevenue" TEXT,
ADD COLUMN     "apolloId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "employeeRange" TEXT,
ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "foundedYear" INTEGER,
ADD COLUMN     "lastFundingDate" TIMESTAMP(3),
ADD COLUMN     "lastFundingRound" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "technologies" JSONB,
ADD COLUMN     "totalFunding" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "apolloId" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "intro_requests" ADD COLUMN     "adminRejectReason" TEXT,
ADD COLUMN     "adminReviewedAt" TIMESTAMP(3),
ADD COLUMN     "adminReviewedById" TEXT,
ADD COLUMN     "adminStatus" TEXT,
ADD COLUMN     "checkedWithContactAt" TIMESTAMP(3),
ADD COLUMN     "checkedWithContactById" TEXT,
ADD COLUMN     "checkedWithContactName" TEXT,
ADD COLUMN     "checkedWithContacts" JSONB,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "declinedById" TEXT,
ADD COLUMN     "detailsRequestedAt" TIMESTAMP(3),
ADD COLUMN     "detailsRequestedById" TEXT;

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "pods" ADD COLUMN     "introReviewMode" TEXT NOT NULL DEFAULT 'end_to_end';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "city" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "companyDomain" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "lastBriefingDate" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "direct_connections" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ContactSources" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "direct_connections_fromUserId_idx" ON "direct_connections"("fromUserId");

-- CreateIndex
CREATE INDEX "direct_connections_toUserId_idx" ON "direct_connections"("toUserId");

-- CreateIndex
CREATE INDEX "direct_connections_status_idx" ON "direct_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "direct_connections_fromUserId_toUserId_key" ON "direct_connections"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_ContactSources_AB_unique" ON "_ContactSources"("A", "B");

-- CreateIndex
CREATE INDEX "_ContactSources_B_index" ON "_ContactSources"("B");

-- CreateIndex
CREATE INDEX "pending_invites_fromUserId_email_idx" ON "pending_invites"("fromUserId", "email");

-- AddForeignKey
ALTER TABLE "intro_requests" ADD CONSTRAINT "intro_requests_declinedById_fkey" FOREIGN KEY ("declinedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_requests" ADD CONSTRAINT "intro_requests_detailsRequestedById_fkey" FOREIGN KEY ("detailsRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_requests" ADD CONSTRAINT "intro_requests_checkedWithContactById_fkey" FOREIGN KEY ("checkedWithContactById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intro_requests" ADD CONSTRAINT "intro_requests_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_connections" ADD CONSTRAINT "direct_connections_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_connections" ADD CONSTRAINT "direct_connections_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactSources" ADD CONSTRAINT "_ContactSources_A_fkey" FOREIGN KEY ("A") REFERENCES "calendar_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactSources" ADD CONSTRAINT "_ContactSources_B_fkey" FOREIGN KEY ("B") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
