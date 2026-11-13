-- Upgrade existing installations that still carry the retired demo paybill.
-- A deliberately admin-configured shortcode is left untouched.
UPDATE "PaymentMethodConfig"
SET "settings" = jsonb_set("settings", '{shortcode}', '"444174"')
WHERE "provider" = 'MPESA_STK'
  AND "settings"->>'shortcode' = '0182774255';
