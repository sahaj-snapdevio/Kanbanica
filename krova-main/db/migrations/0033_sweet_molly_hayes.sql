CREATE UNIQUE INDEX IF NOT EXISTS "credit_purchases_provider_checkout_id_unique" ON "credit_purchases" USING btree ("provider_checkout_id");
