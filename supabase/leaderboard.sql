-- Horde Mayhem leaderboards. Paste this into Supabase: SQL Editor, New query, Run.
-- Anyone can read scores and add new ones; nobody can edit or delete them through the public key.

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  board text not null check (board = 'endless' or board ~ '^daily-[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'),
  name text not null check (char_length(name) between 1 and 16),
  wave int not null check (wave between 1 and 999),
  kills int not null check (kills between 0 and 200000 and kills <= wave * 400),
  map text not null check (char_length(map) <= 16),
  created_at timestamptz not null default now()
);

create index if not exists scores_board_wave on public.scores (board, wave desc, kills desc);

alter table public.scores enable row level security;

drop policy if exists "anyone reads scores" on public.scores;
create policy "anyone reads scores" on public.scores for select to anon, authenticated using (true);

drop policy if exists "anyone adds a score" on public.scores;
create policy "anyone adds a score" on public.scores for insert to anon, authenticated with check (true);
