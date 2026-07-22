-- CreateEnum
CREATE TYPE "TravelMode" AS ENUM ('GROUND', 'FLIGHT');

-- AlterTable

-- AlterTable

-- AlterTable
ALTER TABLE "stops" ADD COLUMN     "travelMode" "TravelMode" NOT NULL DEFAULT 'GROUND';

