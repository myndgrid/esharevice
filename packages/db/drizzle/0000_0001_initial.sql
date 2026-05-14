CREATE TABLE "exchange_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"service" text NOT NULL,
	"date" text NOT NULL,
	"exchange" text NOT NULL,
	"description" text NOT NULL,
	"rate_type" text,
	"img_key" text,
	"img_hash" text,
	"reserved" boolean DEFAULT false NOT NULL,
	"reserved_by" uuid,
	"reserved_at" timestamp with time zone,
	"search" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("provider", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("service", '')), 'B') ||
		setweight(to_tsvector('english', coalesce("description", '')), 'C')
	) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_sub" text NOT NULL,
	"email" "citext" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"postal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_reserved_by_users_id_fk" FOREIGN KEY ("reserved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_items_user_id_idx" ON "exchange_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exchange_items_reserved_idx" ON "exchange_items" USING btree ("reserved");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_sub_uq" ON "users" USING btree ("oidc_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "exchange_items_search_idx" ON "exchange_items" USING gin ("search");