-- CreateTable
CREATE TABLE "user_activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_activity_date_idx" ON "user_activity"("date");

-- CreateIndex
CREATE UNIQUE INDEX "user_activity_userId_date_key" ON "user_activity"("userId", "date");

-- AddForeignKey
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
