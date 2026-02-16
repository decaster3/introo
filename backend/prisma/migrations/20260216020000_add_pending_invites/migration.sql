-- CreateTable
CREATE TABLE "pending_invites" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_invites_email_idx" ON "pending_invites"("email");

-- CreateIndex
CREATE INDEX "pending_invites_status_idx" ON "pending_invites"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_invites_fromUserId_email_key" ON "pending_invites"("fromUserId", "email");

-- AddForeignKey
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
