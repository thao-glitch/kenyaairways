-- CreateEnum
CREATE TYPE "ManualVerifyStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "MpesaManualVerification" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "msisdn" TEXT,
    "paybill" TEXT,
    "accountReference" TEXT,
    "transactionAt" TIMESTAMP(3),
    "messageRaw" TEXT NOT NULL,
    "status" "ManualVerifyStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "bookingId" TEXT,
    "submittedById" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaManualVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaManualVerification_receiptNumber_key" ON "MpesaManualVerification"("receiptNumber");

-- CreateIndex
CREATE INDEX "MpesaManualVerification_status_createdAt_idx" ON "MpesaManualVerification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MpesaManualVerification_bookingId_idx" ON "MpesaManualVerification"("bookingId");

-- AddForeignKey
ALTER TABLE "MpesaManualVerification" ADD CONSTRAINT "MpesaManualVerification_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaManualVerification" ADD CONSTRAINT "MpesaManualVerification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
