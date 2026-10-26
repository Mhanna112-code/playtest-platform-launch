-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ignoredAlerts" TEXT[] DEFAULT ARRAY[]::TEXT[];
