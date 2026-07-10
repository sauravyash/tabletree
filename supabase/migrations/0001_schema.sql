create table app_config (
  key text primary key,
  value jsonb not null
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  active boolean not null default true
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  size text not null,
  flower_count int not null,
  foliage_level text not null,
  price_cents int,
  active boolean not null default true
);

create table variant_options (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id) on delete cascade,
  option_key text not null,
  option_value text not null
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  email text,
  slot_at timestamptz,
  coffee_price_cents int,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_intent_id text,
  redemption_token text not null default encode(gen_random_bytes(6), 'hex'),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  option_snapshot jsonb not null default '{}'::jsonb,
  price_cents_snapshot int not null,
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);
