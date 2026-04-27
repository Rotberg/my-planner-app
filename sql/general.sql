-- ─── Shopping: saved list snapshots ─────────────────────────────────────────
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  delivery_date date,
  created_at timestamptz not null default now()
);

-- Migration: add delivery_date if table already exists without it
alter table shopping_lists add column if not exists delivery_date date;

-- ─── Shopping: items belonging to a saved list ───────────────────────────────
create table if not exists shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  quantity text,
  checked boolean not null default false,
  category text
);

-- Migration: add category if table already exists without it
alter table shopping_list_items add column if not exists category text;

-- ─── Catalog: reusable quick-add item templates ──────────────────────────────
create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Seed common items (skip duplicates)
insert into catalog_items (name) values
  ('Rice'), ('Eggs'), ('Milk'), ('Bread'), ('Butter'),
  ('Chicken'), ('Beef'), ('Pasta'), ('Tomatoes'), ('Onions'),
  ('Garlic'), ('Olive Oil'), ('Salt'), ('Pepper'), ('Sugar'),
  ('Cheese'), ('Yoghurt'), ('Apples'), ('Bananas'), ('Potatoes')
on conflict (name) do nothing;

-- ─── Favorites: starred items for quick re-adding ────────────────────────────
create table if not exists favorite_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ─── Health: body stats time-series log (metric units: kg / cm) ──────────────
create table if not exists health_stats (
  id uuid primary key default gen_random_uuid(),
  recorded_at date not null default current_date,
  weight numeric,   -- kg
  waist  numeric,   -- cm
  chest  numeric,   -- cm
  hips   numeric,   -- cm
  arms   numeric,   -- cm
  thighs numeric,   -- cm
  notes text,
  created_at timestamptz not null default now()
);

-- ─── Health: completed workout sessions (history) ────────────────────────────
create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  name text,
  performed_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists workout_session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references workout_sessions(id) on delete cascade,
  name text not null,
  sets text,
  reps text,
  weight text,
  notes text,
  position int not null default 0
);

-- ─── Health: saved workout routine snapshots ─────────────────────────────────
create table if not exists workout_routines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─── Health: exercises belonging to a saved routine ──────────────────────────
create table if not exists workout_routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references workout_routines(id) on delete cascade,
  name text not null,
  sets text,
  reps text,
  weight text,    -- e.g. "20kg"
  notes text,
  position int not null default 0
);

-- ─── Health: exercise catalog (reusable quick-add templates) ─────────────────
create table if not exists exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Seed common exercises (skip duplicates)
insert into exercise_catalog (name) values
  ('Bench Press'), ('Squat'), ('Deadlift'), ('Overhead Press'), ('Barbell Row'),
  ('Pull-up'), ('Push-up'), ('Lunge'), ('Bicep Curl'), ('Tricep Extension'),
  ('Lat Pulldown'), ('Leg Press'), ('Plank'), ('Sit-up'), ('Running')
on conflict (name) do nothing;
