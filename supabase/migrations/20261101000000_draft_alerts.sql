-- Draft alerts, on by default (Settings can turn them off): "⏰ You're on the clock" when a
-- manager's team comes up in a live draft, sent by the draft function right after the pick,
-- pass or start that put them there. Autodraft teams aren't alerted: their pick is made for them.

alter table public.push_subscriptions
  add column draft_alerts boolean not null default true;
