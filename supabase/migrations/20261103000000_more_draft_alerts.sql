-- More draft alerts (Settings → Draft alerts), each with its own switch: "📣 Draft 2 is live" to
-- every league member when the commissioner starts a draft (on by default), "🤖 Autodraft took
-- Juan Soto" when autodraft picks for your team (off by default), and "✅ Draft 2 is done" when
-- the last pick is made (on by default). The draft function sends them.

alter table public.push_subscriptions
  add column draft_started_alerts boolean not null default true,
  add column autopick_alerts boolean not null default false,
  add column draft_done_alerts boolean not null default true;
