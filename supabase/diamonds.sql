-- Real-money diamond purchases. Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Only the Stripe webhook (server side, service role) can add rows. The game can only *claim*
-- rows for its own buyer id, once, through claim_diamonds(). Nobody can read or edit the table.

create table if not exists public.diamond_purchases (
  id bigint generated always as identity primary key,
  session_id text not null unique,          -- Stripe Checkout session id: one credit per payment
  buyer uuid not null,                      -- random id stored in the player's save
  pack text not null,
  diamonds int not null check (diamonds > 0 and diamonds <= 10000),
  amount_cents int not null,
  currency text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists diamond_purchases_buyer on public.diamond_purchases (buyer) where claimed_at is null;

alter table public.diamond_purchases enable row level security;
-- No policies on purpose: the publishable key can't select, insert, update or delete.
revoke all on public.diamond_purchases from anon, authenticated;

-- Marks every unclaimed purchase for this buyer as claimed and returns how many diamonds that was.
-- Atomic, so a purchase can never be claimed twice even if two tabs ask at once.
create or replace function public.claim_diamonds(p_buyer uuid)
returns int
language sql
security definer
set search_path = public
as $$
  with c as (
    update public.diamond_purchases
       set claimed_at = now()
     where buyer = p_buyer and claimed_at is null
    returning diamonds
  )
  select coalesce(sum(diamonds), 0)::int from c;
$$;

revoke all on function public.claim_diamonds(uuid) from public;
grant execute on function public.claim_diamonds(uuid) to anon, authenticated;
