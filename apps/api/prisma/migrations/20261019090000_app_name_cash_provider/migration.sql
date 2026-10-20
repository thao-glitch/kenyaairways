-- Live, admin-editable app name (updates everywhere from site settings).
ALTER TABLE "SiteSettings" ADD COLUMN "appName" TEXT NOT NULL DEFAULT 'Kenya Airways';

-- Payments taken directly by staff (cash / card terminal at the counter).
ALTER TYPE "PaymentProviderType" ADD VALUE 'CASH';
