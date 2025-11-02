-- Notifications table for marketplace sellers (and buyers if extended)
-- Run in Supabase SQL editor.

create table if not exists public.marketplace_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.marketplace_notifications(user_id);
create index if not exists idx_notifications_created on public.marketplace_notifications(created_at desc);

alter table public.marketplace_notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.marketplace_notifications;
create policy "Users can read own notifications"
  on public.marketplace_notifications
  for select
  using (auth.uid() = user_id);

drop policy if exists "Authenticated users can create notifications" on public.marketplace_notifications;
create policy "Authenticated users can create notifications"
  on public.marketplace_notifications
  for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "Users can update read_at on own notifications" on public.marketplace_notifications;
create policy "Users can update read_at on own notifications"
  on public.marketplace_notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Ensure marketplace_orders has a shipping_address snapshot field
alter table public.marketplace_orders
  add column if not exists shipping_address jsonb;
