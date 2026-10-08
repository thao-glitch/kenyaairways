-- AddForeignKey
ALTER TABLE "BookingSegment" ADD CONSTRAINT "BookingSegment_fareClassId_fkey" FOREIGN KEY ("fareClassId") REFERENCES "FareClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
