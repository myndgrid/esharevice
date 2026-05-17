-- 0007_0001 — Listing taxonomy: 5 listing types + categories + paid-listing
-- fields. Foundational migration for the marketplace pivot (PRs 3, 4, 8+).
--
-- Why this is additive-only and safe to ship before any UI consumes it:
--   * `listing_type` defaults to 'trade' so every existing row stays a trade
--     listing without explicit backfill. The column is NOT NULL with a default.
--   * `exchange` flips to nullable so non-trade listings (gift/rent/hire/sell)
--     can omit a "what I want in return" line. Existing rows already have a
--     non-null value; nullable is strictly looser.
--   * Every new column is nullable (the price/condition/location/availability
--     set). No backfill is required for old data.
--   * `category_id` is nullable FK + ON DELETE SET NULL — wiping a category
--     never deletes a listing.
--   * `categories` is seeded with 40 leaf entries idempotently
--     (ON CONFLICT (slug) DO NOTHING) so re-running the migration in dev is
--     safe.
--
-- The API gates new behavior (type-discriminated bodies, /v1/categories) on
-- FEATURE_LISTING_TYPES; the schema lives in prod from day one.

-- ─────────────────────── Enums

DO $$ BEGIN
  CREATE TYPE listing_type AS ENUM ('gift', 'trade', 'rent', 'hire', 'sell');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE price_unit AS ENUM ('hour', 'day', 'fixed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_condition AS ENUM ('new', 'like_new', 'good', 'fair', 'well_used');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE location_precision AS ENUM ('exact', 'street', 'neighbourhood', 'postal_code', 'city');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────── Categories (40-row seed)

CREATE TABLE IF NOT EXISTS "categories" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"          text NOT NULL UNIQUE,
  "name"          text NOT NULL,
  "parent_slug"   text,
  "icon"          text,                 -- Lucide icon name, optional
  "display_order" integer NOT NULL DEFAULT 0,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "categories_parent_slug_idx" ON "categories" ("parent_slug");
CREATE INDEX IF NOT EXISTS "categories_display_order_idx" ON "categories" ("display_order");

INSERT INTO "categories" (slug, name, parent_slug, icon, display_order) VALUES
  -- Tools
  ('tools-hand',          'Hand tools',              'tools',     'wrench',          10),
  ('tools-power',         'Power tools',             'tools',     'drill',           11),
  ('tools-garden',        'Garden tools',            'tools',     'shovel',          12),
  ('tools-auto',          'Auto + mechanic',         'tools',     'car',             13),
  ('tools-specialty',     'Specialty + heavy',       'tools',     'forklift',        14),
  -- Kitchen
  ('kitchen-mixers',      'Mixers + appliances',     'kitchen',   'cake-slice',      20),
  ('kitchen-bakeware',    'Bakeware',                'kitchen',   'cookie',          21),
  ('kitchen-party',       'Party serveware',         'kitchen',   'wine',            22),
  ('kitchen-specialty',   'Specialty cookware',      'kitchen',   'utensils',        23),
  -- Wheels
  ('wheels-bikes',        'Bikes',                   'wheels',    'bike',            30),
  ('wheels-scooters',     'Scooters + e-bikes',      'wheels',    'zap',             31),
  ('wheels-strollers',    'Strollers + trailers',    'wheels',    'baby',            32),
  ('wheels-cargo',        'Car-rack + cargo',        'wheels',    'truck',           33),
  -- Garden
  ('garden-lawn',         'Lawn equipment',          'garden',    'leaf',            40),
  ('garden-plants',       'Plants + cuttings',       'garden',    'sprout',          41),
  ('garden-furniture',    'Outdoor furniture',       'garden',    'armchair',        42),
  -- Studio
  ('studio-photo',        'Photo + video gear',      'studio',    'camera',          50),
  ('studio-music',        'Music gear',              'studio',    'music',           51),
  ('studio-art',          'Art supplies',            'studio',    'palette',         52),
  -- Lessons
  ('lessons-music',       'Music lessons',           'lessons',   'music-2',         60),
  ('lessons-languages',   'Language lessons',        'lessons',   'languages',       61),
  ('lessons-tutoring',    'Tutoring (K–12)',         'lessons',   'graduation-cap',  62),
  ('lessons-coding',      'Coding + digital',        'lessons',   'code',            63),
  ('lessons-fitness',     'Fitness coaching',        'lessons',   'dumbbell',        64),
  -- Services
  ('services-handyman',   'Handyman + repair',       'services',  'hammer',          70),
  ('services-cleaning',   'Cleaning',                'services',  'spray-can',       71),
  ('services-yard',       'Yard + landscaping',      'services',  'trees',           72),
  ('services-moving',     'Moving + delivery',       'services',  'truck',           73),
  ('services-petcare',    'Pet care',                'services',  'dog',             74),
  ('services-tech',       'Tech support',            'services',  'laptop',          75),
  -- Edibles
  ('edibles-baked',       'Baked goods',             'edibles',   'cookie',          80),
  ('edibles-produce',     'Produce + groceries',     'edibles',   'apple',           81),
  ('edibles-preserves',   'Preserves + ferments',    'edibles',   'jar',             82),
  -- Sports
  ('sports-camping',      'Camping + outdoors',      'sports',    'tent',            90),
  ('sports-snow',         'Skiing + snow',           'sports',    'snowflake',       91),
  ('sports-water',        'Watersports',             'sports',    'waves',           92),
  -- Kids
  ('kids-toys',           'Toys + games',            'kids',      'toy-brick',      100),
  ('kids-books',          'Books + media',           'kids',      'book',           101),
  -- Apparel + Free
  ('apparel-adult',       'Apparel (adult)',         'apparel',   'shirt',          110),
  ('free-handmedowns',    'Free hand-me-downs',      'free',      'gift',           120)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────── exchange_items extensions

-- `exchange` becomes nullable so non-trade listings can omit a "wants" line.
-- Existing rows already have non-null values; loosening the constraint is
-- strictly compatible.
ALTER TABLE "exchange_items"
  ALTER COLUMN "exchange" DROP NOT NULL;

ALTER TABLE "exchange_items"
  ADD COLUMN IF NOT EXISTS "listing_type"        listing_type        NOT NULL DEFAULT 'trade',
  ADD COLUMN IF NOT EXISTS "price_cents"         integer,
  ADD COLUMN IF NOT EXISTS "price_unit"          price_unit,
  ADD COLUMN IF NOT EXISTS "deposit_cents"       integer,
  ADD COLUMN IF NOT EXISTS "condition"           item_condition,
  ADD COLUMN IF NOT EXISTS "available_from"      timestamptz,
  ADD COLUMN IF NOT EXISTS "available_to"        timestamptz,
  ADD COLUMN IF NOT EXISTS "location_lat"        numeric(9, 6),
  ADD COLUMN IF NOT EXISTS "location_lng"        numeric(9, 6),
  ADD COLUMN IF NOT EXISTS "location_precision"  location_precision,
  ADD COLUMN IF NOT EXISTS "category_id"         uuid REFERENCES "categories"("id") ON DELETE SET NULL;

-- Defensive CHECK constraints — Postgres enforces what Zod can't reach in
-- direct SQL writes (admin scripts, future cron jobs, manual fixes).
ALTER TABLE "exchange_items"
  ADD CONSTRAINT "exchange_items_price_cents_nonneg"
    CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
  ADD CONSTRAINT "exchange_items_deposit_cents_nonneg"
    CHECK ("deposit_cents" IS NULL OR "deposit_cents" >= 0),
  ADD CONSTRAINT "exchange_items_lat_range"
    CHECK ("location_lat" IS NULL OR ("location_lat" BETWEEN -90  AND 90)),
  ADD CONSTRAINT "exchange_items_lng_range"
    CHECK ("location_lng" IS NULL OR ("location_lng" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "exchange_items_available_range"
    CHECK ("available_to" IS NULL OR "available_from" IS NULL OR "available_to" >= "available_from"),
  -- Paid types require a price; gift/trade must NOT carry one. The API's
  -- superRefine catches this at the boundary, but SQL is the final word.
  ADD CONSTRAINT "exchange_items_paid_requires_price"
    CHECK (
      ("listing_type" IN ('rent','hire','sell') AND "price_cents" IS NOT NULL)
      OR
      ("listing_type" IN ('gift','trade') AND "price_cents" IS NULL)
    );

-- Read-path indexes — every new filter query the API exposes hits one of
-- these. `partial WHERE archived_at IS NULL` keeps the indexes lean because
-- archived rows are excluded from every public read anyway.
CREATE INDEX IF NOT EXISTS "exchange_items_listing_type_idx"
  ON "exchange_items" ("listing_type")
  WHERE "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "exchange_items_category_id_idx"
  ON "exchange_items" ("category_id")
  WHERE "archived_at" IS NULL;

CREATE INDEX IF NOT EXISTS "exchange_items_price_cents_idx"
  ON "exchange_items" ("price_cents")
  WHERE "archived_at" IS NULL AND "price_cents" IS NOT NULL;

-- Geo bbox filtering — composite on (lat, lng) for a single index seek on the
-- usual viewport query. PostGIS would be better for a real distance search,
-- but bbox + Haversine in app code covers v1 without the extension dependency.
CREATE INDEX IF NOT EXISTS "exchange_items_location_idx"
  ON "exchange_items" ("location_lat", "location_lng")
  WHERE "archived_at" IS NULL AND "location_lat" IS NOT NULL AND "location_lng" IS NOT NULL;
