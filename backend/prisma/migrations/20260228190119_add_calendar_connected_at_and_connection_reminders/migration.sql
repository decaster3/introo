-- AlterTable
ALTER TABLE "direct_connections" ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pending_invites" ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "calendarConnectedAt" TIMESTAMP(3),
ADD COLUMN     "calendarRemindersSent" INTEGER NOT NULL DEFAULT 0;
