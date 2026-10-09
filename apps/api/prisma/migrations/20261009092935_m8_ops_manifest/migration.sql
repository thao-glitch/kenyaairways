-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'DISPATCHED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ManifestDispatch" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "endpoint" TEXT,
    "operator" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "payloadDigest" TEXT,
    "requestedById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManifestDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManifestDispatch_flightId_createdAt_idx" ON "ManifestDispatch"("flightId", "createdAt");

-- CreateIndex
CREATE INDEX "ManifestDispatch_status_createdAt_idx" ON "ManifestDispatch"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ManifestDispatch" ADD CONSTRAINT "ManifestDispatch_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
