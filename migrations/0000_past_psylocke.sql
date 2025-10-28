CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"bank_org" text,
	"bank_fid" text,
	"bank_name" text NOT NULL,
	"bank_code" text,
	"branch" text,
	"account_number_mask" text NOT NULL,
	"account_type" text NOT NULL,
	"currency" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_org_id_organizations_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_client_id_clients_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_org_fingerprint_key" ON "bank_accounts" USING btree ("org_id","account_fingerprint");--> statement-breakpoint
CREATE INDEX "bank_accounts_org_client_active_idx" ON "bank_accounts" USING btree ("org_id","client_id","is_active");