/*
  Warnings:

  - A unique constraint covering the columns `[bookingId]` on the table `MessageThread` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_bookingId_key" ON "MessageThread"("bookingId");
