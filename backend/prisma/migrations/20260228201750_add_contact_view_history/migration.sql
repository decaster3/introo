-- CreateTable
CREATE TABLE "contact_view_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_view_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_view_history_userId_createdAt_idx" ON "contact_view_history"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_view_history" ADD CONSTRAINT "contact_view_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
