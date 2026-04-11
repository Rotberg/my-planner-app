-- ─── Tasks ───────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  done boolean not null default false,
  priority text not null default 'medium',
  due_date timestamptz,
  created_at timestamptz not null default now()
);

-- ─── Shopping: active items (current working list) ───────────────────────────
create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity text,
  checked boolean not null default false,
  favorited boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── Shopping: saved list snapshots ─────────────────────────────────────────
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─── Shopping: items belonging to a saved list ───────────────────────────────
create table if not exists shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists(id) on delete cascade,
  name text not null,
  quantity text,
  checked boolean not null default false
);

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
