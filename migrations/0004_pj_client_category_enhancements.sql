ALTER TABLE "pj_client_categories"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "accepts_postings" boolean DEFAULT true;

ALTER TABLE "pj_client_categories"
  ALTER COLUMN "accepts_postings" SET NOT NULL;
