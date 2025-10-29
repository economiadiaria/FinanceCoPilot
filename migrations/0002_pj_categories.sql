CREATE TABLE "pj_categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "parent_id" uuid,
        "code" text NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "is_core" boolean DEFAULT false NOT NULL,
        "accepts_postings" boolean DEFAULT true NOT NULL,
        "level" integer NOT NULL,
        "path" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pj_categories" ADD CONSTRAINT "pj_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pj_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pj_categories_code_key" ON "pj_categories" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "pj_categories_parent_name_key" ON "pj_categories" USING btree ("parent_id","name");
--> statement-breakpoint
CREATE INDEX "pj_categories_parent_idx" ON "pj_categories" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "pj_categories_level_idx" ON "pj_categories" USING btree ("level");
--> statement-breakpoint
CREATE INDEX "pj_categories_path_idx" ON "pj_categories" USING btree ("path");
--> statement-breakpoint
COMMENT ON TABLE "pj_categories" IS 'Categorias de plano de contas utilizadas no dashboard PJ.';
--> statement-breakpoint
COMMENT ON COLUMN "pj_categories"."is_core" IS 'Registros núcleo mantidos pelo sistema. Não podem ser atualizados ou removidos.';
--> statement-breakpoint
COMMENT ON COLUMN "pj_categories"."accepts_postings" IS 'Indica se lançamentos detalhados podem ser associados diretamente à categoria.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_core_pj_category_modification"() RETURNS trigger AS $$
BEGIN
        IF OLD.is_core THEN
                RAISE EXCEPTION 'Core PJ categories cannot be % operations', lower(TG_OP);
        END IF;
        IF TG_OP = 'DELETE' THEN
                RETURN OLD;
        END IF;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."set_pj_categories_updated_at"() RETURNS trigger AS $$
BEGIN
        NEW.updated_at = now();
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "prevent_core_pj_category_update"
BEFORE UPDATE ON "pj_categories"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_core_pj_category_modification"();
--> statement-breakpoint
CREATE TRIGGER "prevent_core_pj_category_delete"
BEFORE DELETE ON "pj_categories"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_core_pj_category_modification"();
--> statement-breakpoint
CREATE TRIGGER "pj_categories_set_updated_at"
BEFORE UPDATE ON "pj_categories"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_pj_categories_updated_at"();
--> statement-breakpoint
INSERT INTO "pj_categories" (code, name, description, is_core, accepts_postings, level, path, sort_order)
VALUES
        ('RECEITA', 'Receitas', 'Entradas operacionais de vendas e serviços.', true, false, 1, 'RECEITA', 10),
        ('DEDUCOES_RECEITA', '(-) Deduções da Receita', 'Descontos, impostos e devoluções associados às receitas.', true, false, 1, 'DEDUCOES_RECEITA', 20),
        ('GEA', '(-) Despesas Gerais e Administrativas', 'Custos operacionais administrativos.', true, false, 1, 'GEA', 30),
        ('COMERCIAL_MKT', '(-) Despesas Comerciais e Marketing', 'Gastos comerciais e de marketing.', true, false, 1, 'COMERCIAL_MKT', 40),
        ('FINANCEIRAS', '(-/+) Despesas e Receitas Financeiras', 'Receitas e despesas financeiras.', true, false, 1, 'FINANCEIRAS', 50),
        ('OUTRAS', '(-/+) Outras Despesas e Receitas Não Operacionais', 'Eventos não operacionais.', true, false, 1, 'OUTRAS', 60);
--> statement-breakpoint
COMMENT ON COLUMN "pj_categories"."path" IS 'Representa o caminho hierárquico completo da categoria. Para raízes, deve coincidir com o código.';
--> statement-breakpoint
COMMENT ON COLUMN "pj_categories"."sort_order" IS 'Ordenação sugerida para exibição das categorias de primeiro nível.';
--> statement-breakpoint
COMMENT ON COLUMN "pj_categories"."level" IS 'Nível hierárquico (1 = categoria raiz).';
