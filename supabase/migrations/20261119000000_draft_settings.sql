-- Draft settings (RULES.md, Drafts), set by the commissioner until the draft is complete: where
-- the first-round pick order comes from and whether it snakes. The draft function applies them
-- when the draft starts.

create type public.draft_order_by as enum ('random', 'rank', 'raffle');
create type public.draft_pattern as enum ('snake', 'circular');

alter table public.drafts
  -- Null: the draft's default, random for Drafts 1 and 2 and the previous round's ranking for 3 and 4.
  add column order_by public.draft_order_by,
  add column pattern public.draft_pattern not null default 'snake',
  -- A raffle draft's draw, set when it starts: [{ "teamId", "tickets" }], in the order drawn.
  add column raffle jsonb;
