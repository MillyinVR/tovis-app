/*
  Warnings:

  - Made the column `storageBucket` on table `MediaAsset` required. This step will fail if there are existing NULL values in that column.
  - Made the column `storagePath` on table `MediaAsset` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MediaAsset" ALTER COLUMN "storageBucket" SET NOT NULL,
ALTER COLUMN "storagePath" SET NOT NULL;
