-- AlterTable
ALTER TABLE "LoginToken" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'login';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '';

