CREATE TABLE "pj_client_categories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "org_id" uuid NOT NULL,
    "client_id" uuid NOT NULL,
    "base_category_id" uuid,
    "name" text NOT NULL,
    "type" text NOT NULL,
    "parent_id" uuid,
    "level" integer DEFAULT 0 NOT NULL,
    "path" text DEFAULT '' NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pj_client_categories" ADD CONSTRAINT "pj_client_categories_org_id_organizations_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pj_client_categories" ADD CONSTRAINT "pj_client_categories_client_id_clients_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pj_client_categories" ADD CONSTRAINT "pj_client_categories_base_category_id_pj_categories_fk" FOREIGN KEY ("base_category_id") REFERENCES "public"."pj_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pj_client_categories" ADD CONSTRAINT "pj_client_categories_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pj_client_categories"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "pj_client_categories_client_id_idx" ON "pj_client_categories" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "pj_client_categories_parent_id_idx" ON "pj_client_categories" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "pj_client_categories_level_idx" ON "pj_client_categories" USING btree ("level");
--> statement-breakpoint
CREATE INDEX "pj_client_categories_path_idx" ON "pj_client_categories" USING btree ("path");
--> statement-breakpoint
CREATE UNIQUE INDEX "pj_client_categories_client_base_category_key" ON "pj_client_categories" USING btree ("client_id","base_category_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pj_client_categories_client_parent_name_key" ON "pj_client_categories" USING btree ("client_id","parent_id","name");
--> statement-breakpoint
COMMENT ON COLUMN "pj_client_categories"."base_category_id" IS 'Vínculo com a categoria global do plano PJ (pj_categories).';
--> statement-breakpoint
COMMENT ON TABLE "pj_client_categories" IS 'Categorias personalizadas de clientes PJ derivadas do plano global.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pj_client_categories_set_meta"()
RETURNS trigger AS $$
DECLARE
    parent_path text;
    parent_level integer;
    sibling_sort integer;
BEGIN
    IF NEW.id IS NULL THEN
        NEW.id := gen_random_uuid();
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := now();
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
        SELECT "path", "level" INTO parent_path, parent_level
        FROM "pj_client_categories"
        WHERE "id" = NEW.parent_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Categoria pai % não encontrada para cliente %', NEW.parent_id, NEW.client_id;
        END IF;

        NEW.level := parent_level + 1;
        NEW.path := parent_path || '.' || NEW.id::text;
    ELSE
        NEW.level := 0;
        NEW.path := NEW.id::text;
    END IF;

    IF NEW.sort_order IS NULL OR (TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
        SELECT COALESCE(MAX("sort_order") + 1, 1) INTO sibling_sort
        FROM "pj_client_categories"
        WHERE "client_id" = NEW.client_id
          AND ( ("parent_id" IS NULL AND NEW.parent_id IS NULL) OR "parent_id" = NEW.parent_id )
          AND "id" <> NEW.id;

        IF sibling_sort IS NULL THEN
            sibling_sort := 1;
        END IF;

        NEW.sort_order := sibling_sort;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pj_client_categories_refresh_subtree"()
RETURNS trigger AS $$
BEGIN
    WITH RECURSIVE tree AS (
        SELECT c."id", c."parent_id", NEW.path || '.' || c."id"::text AS computed_path
        FROM "pj_client_categories" c
        WHERE c."parent_id" = NEW."id"
        UNION ALL
        SELECT c2."id", c2."parent_id", tree.computed_path || '.' || c2."id"::text
        FROM "pj_client_categories" c2
        JOIN tree ON c2."parent_id" = tree."id"
    )
    UPDATE "pj_client_categories" AS c
    SET "path" = tree.computed_path,
        "level" = array_length(string_to_array(tree.computed_path, '.'), 1) - 1
    FROM tree
    WHERE c."id" = tree."id";

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "pj_client_categories_set_meta_trg"
BEFORE INSERT OR UPDATE ON "pj_client_categories"
FOR EACH ROW EXECUTE FUNCTION "pj_client_categories_set_meta"();
--> statement-breakpoint
CREATE TRIGGER "pj_client_categories_refresh_subtree_trg"
AFTER UPDATE OF "parent_id" ON "pj_client_categories"
FOR EACH ROW EXECUTE FUNCTION "pj_client_categories_refresh_subtree"();
