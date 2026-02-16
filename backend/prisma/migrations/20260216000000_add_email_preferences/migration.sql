-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailPreferences" JSONB NOT NULL DEFAULT '{"intros":true,"notifications":true,"digests":true}';
