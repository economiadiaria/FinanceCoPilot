CREATE TABLE "bank_account_summary_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "org_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "bank_account_id" uuid NOT NULL,
        "window" text NOT NULL,
        "totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "kpis" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_account_summary_snapshots" ADD CONSTRAINT "bank_account_summary_snapshots_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_summary_snapshots" ADD CONSTRAINT "bank_account_summary_snapshots_client_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_summary_snapshots" ADD CONSTRAINT "bank_account_summary_snapshots_account_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_account_summary_snapshots_unique_window" ON "bank_account_summary_snapshots" USING btree ("org_id","client_id","bank_account_id","window");--> statement-breakpoint
CREATE INDEX "bank_account_summary_snapshots_org_client_idx" ON "bank_account_summary_snapshots" USING btree ("org_id","client_id");
