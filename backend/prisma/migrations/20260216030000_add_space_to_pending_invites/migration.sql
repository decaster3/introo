-- DropIndex
DROP INDEX IF EXISTS "pending_invites_fromUserId_email_key";

-- AlterTable
ALTER TABLE "pending_invites" ADD COLUMN "spaceId" TEXT;

-- CreateIndex
CREATE INDEX "pending_invites_spaceId_idx" ON "pending_invites"("spaceId");

-- CreateIndex (nullable spaceId uses COALESCE for uniqueness)
CREATE UNIQUE INDEX "pending_invites_fromUserId_email_spaceId_key" ON "pending_invites"("fromUserId", "email", COALESCE("spaceId", ''));

-- AddForeignKey
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "pods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
