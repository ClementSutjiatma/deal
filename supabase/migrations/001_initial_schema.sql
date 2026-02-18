-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================
-- USERS
-- ============================================
create table public.users (
  id              uuid primary key default gen_random_uuid(),
  phone           text unique not null,
  email           text,
  name            text,
  wallet_address  text,
  privy_user_id   text unique,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index idx_users_phone on public.users(phone);
create index idx_users_privy_user_id on public.users(privy_user_id);

-- ============================================
-- DEALS
-- ============================================
create table public.deals (
  id              uuid primary key default gen_random_uuid(),
  short_code      text unique not null,
  status          text not null default 'OPEN',
  seller_id       uuid references public.users(id) not null,
  buyer_id        uuid references public.users(id),
  event_name      text not null,
  event_date      timestamptz,
  venue           text,
  section         text,
  "row"           text,
  seats           text,
  num_tickets     int not null,
  price_cents     int not null,
  transfer_method text,
  terms           jsonb,
  escrow_tx_hash  text,
  chat_mode       text default 'open' not null,
  locked_at       timestamptz,
  funded_at       timestamptz,
  transferred_at  timestamptz,
  confirmed_at    timestamptz,
  disputed_at     timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index idx_deals_short_code on public.deals(short_code);
create index idx_deals_seller_id on public.deals(seller_id);
create index idx_deals_buyer_id on public.deals(buyer_id);
create index idx_deals_status on public.deals(status);

-- ============================================
-- MESSAGES
-- ============================================
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references public.deals(id) not null,
  sender_id       uuid references public.users(id),
  role            text not null,
  channel         text not null default 'web',
  visibility      text not null default 'all',
  content         text not null,
  media_urls      text[],
  metadata        jsonb,
  created_at      timestamptz default now() not null
);

create index idx_messages_deal_id on public.messages(deal_id);
create index idx_messages_deal_created on public.messages(deal_id, created_at);

-- ============================================
-- DEAL EVENTS
-- ============================================
create table public.deal_events (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references public.deals(id) not null,
  event_type      text not null,
  actor_id        uuid references public.users(id),
  metadata        jsonb,
  created_at      timestamptz default now() not null
);

create index idx_deal_events_deal_id on public.deal_events(deal_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Users table: users can read/update their own row
alter table public.users enable row level security;

create policy "Users can read own profile"
  on public.users for select
  using (true); -- public read for now (names shown on deals)

create policy "Users can update own profile"
  on public.users for update
  using (id = auth.uid());

-- Deals table: anyone can read (deals are public via link), participants can update
alter table public.deals enable row level security;

create policy "Anyone can read deals"
  on public.deals for select
  using (true);

create policy "Sellers can create deals"
  on public.deals for insert
  with check (seller_id = auth.uid());

create policy "Participants can update deals"
  on public.deals for update
  using (seller_id = auth.uid() or buyer_id = auth.uid());

-- Messages: visibility-filtered reads
alter table public.messages enable row level security;

create policy "Users can read visible messages"
  on public.messages for select
  using (
    visibility = 'all'
    or (visibility = 'seller_only' and sender_id in (
      select seller_id from public.deals where id = deal_id
    ))
    or (visibility = 'buyer_only' and sender_id in (
      select buyer_id from public.deals where id = deal_id
    ))
    -- AI/system messages with visibility filters
    or (visibility = 'seller_only' and auth.uid() in (
      select seller_id from public.deals where id = deal_id
    ))
    or (visibility = 'buyer_only' and auth.uid() in (
      select buyer_id from public.deals where id = deal_id
    ))
  );

create policy "Anyone can insert messages"
  on public.messages for insert
  with check (true); -- API handles auth

-- Deal events: public read
alter table public.deal_events enable row level security;

create policy "Anyone can read deal events"
  on public.deal_events for select
  using (true);

create policy "System can insert deal events"
  on public.deal_events for insert
  with check (true); -- API handles auth

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_users
  before update on public.users
  for each row execute function public.handle_updated_at();

create trigger set_updated_at_deals
  before update on public.deals
  for each row execute function public.handle_updated_at();

-- ============================================
-- ATOMIC DEAL CLAIM FUNCTION
-- ============================================
create or replace function public.claim_deal(
  p_deal_id uuid,
  p_buyer_id uuid
) returns boolean as $$
declare
  rows_affected int;
begin
  update public.deals
  set
    buyer_id = p_buyer_id,
    status = 'FUNDED',
    locked_at = now(),
    funded_at = now(),
    chat_mode = 'active'
  where id = p_deal_id
    and status = 'OPEN'
    and buyer_id is null;

  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end;
$$ language plpgsql;

-- ============================================
-- REALTIME
-- ============================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.deals;
