-- CreateEnum
CREATE TYPE "PriceAlertStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AircraftType" ADD COLUMN     "co2GramsPerPaxKm" INTEGER;

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originCode" TEXT NOT NULL,
    "destinationCode" TEXT NOT NULL,
    "cabin" "CabinClass" NOT NULL DEFAULT 'ECONOMY',
    "targetMinor" INTEGER,
    "lowestSeenMinor" INTEGER,
    "status" "PriceAlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredAt" TIMESTAMP(3),

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceAlert_userId_status_createdAt_idx" ON "PriceAlert"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PriceAlert_status_idx" ON "PriceAlert"("status");

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
