-- ============================================
-- CONVERSATIONS (per-buyer thread on a deal)
-- ============================================
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references public.deals(id) not null,
  buyer_id        uuid references public.users(id) not null,
  status          text not null default 'active',
  negotiated_price_cents  int,
  last_message_preview    text,
  last_message_at         timestamptz,
  message_count           int not null default 0,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,

  unique(deal_id, buyer_id)
);

create index idx_conversations_deal_id on public.conversations(deal_id);
create index idx_conversations_buyer_id on public.conversations(buyer_id);

-- Add conversation_id to messages
alter table public.messages add column conversation_id uuid references public.conversations(id);
create index idx_messages_conversation_id on public.messages(conversation_id);

-- Updated_at trigger (reuses existing handle_updated_at function)
create trigger set_updated_at_conversations
  before update on public.conversations
  for each row execute function public.handle_updated_at();

-- RLS for conversations
alter table public.conversations enable row level security;

create policy "Anyone can read conversations"
  on public.conversations for select
  using (true);

create policy "Anyone can insert conversations"
  on public.conversations for insert
  with check (true);

create policy "Anyone can update conversations"
  on public.conversations for update
  using (true);

-- Add conversations to realtime
alter publication supabase_realtime add table public.conversations;
