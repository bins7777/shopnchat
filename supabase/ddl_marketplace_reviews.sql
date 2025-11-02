-- Marketplace reviews table
-- Run this in Supabase SQL editor (or psql) in your project.

create table if not exists public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  buyer_id uuid not null references public.users(id) on delete cascade,
  order_item_id uuid references public.marketplace_order_items(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.marketplace_reviews
  add column if not exists order_item_id uuid references public.marketplace_order_items(id) on delete set null;

alter table public.marketplace_reviews
  add column if not exists media jsonb not null default '[]'::jsonb;

-- Helpful indexes
create index if not exists idx_reviews_listing on public.marketplace_reviews(listing_id);
create index if not exists idx_reviews_buyer on public.marketplace_reviews(buyer_id);
create unique index if not exists idx_reviews_order_item_unique
  on public.marketplace_reviews(order_item_id)
  where order_item_id is not null;

-- Enable RLS and basic policies
alter table public.marketplace_reviews enable row level security;

-- Everyone can read reviews
drop policy if exists "Reviews are viewable by everyone" on public.marketplace_reviews;
create policy "Reviews are viewable by everyone"
  on public.marketplace_reviews
  for select
  using (true);

-- Only authenticated users can create reviews
drop policy if exists "Authenticated users can create reviews" on public.marketplace_reviews;
create policy "Authenticated users can create reviews"
  on public.marketplace_reviews
  for insert
  with check (auth.role() = 'authenticated');

-- Review authors can update/delete their own reviews
drop policy if exists "Authors can update their reviews" on public.marketplace_reviews;
create policy "Authors can update their reviews"
  on public.marketplace_reviews
  for update
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

drop policy if exists "Authors can delete their reviews" on public.marketplace_reviews;
create policy "Authors can delete their reviews"
  on public.marketplace_reviews
  for delete
  using (buyer_id = auth.uid());

-- Optional: add counters to your public.users profile table if missing
alter table public.users
  add column if not exists orders_count integer not null default 0,
  add column if not exists cart_items integer not null default 0;
