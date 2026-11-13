-- Sync schema columns that were added to the Prisma model after the last
-- migration. Without these, a fresh `prisma migrate deploy` leaves the
-- database missing `Airport.continent` and seeding fails.
ALTER TABLE "Airport" ADD COLUMN "continent" TEXT NOT NULL DEFAULT 'africa';

ALTER TABLE "SiteSettings" ALTER COLUMN "appName" SET DEFAULT 'Kenya Airways.';
