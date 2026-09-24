# Baggery

Fantasy baseball for the MLB postseason. Managers draft 4 hitters, bags (total bases)
decide who survives each round. Rules: [docs/RULES.md](docs/RULES.md). Plan and
architecture: [docs/PLAN.md](docs/PLAN.md).

## Layout

- `app/`: Expo app (web now, iOS later). Has its own [CLAUDE.md](app/CLAUDE.md) for Expo specifics.
- `supabase/migrations/`: Postgres schema. Never edit an applied migration; add a new one.
- `supabase/functions/`: Edge Functions (Deno). `draft` (all draft room actions, in one locked
  transaction) and `sync-pool` (builds the draft pool from the MLB Stats API).
- `supabase/functions/_shared/core/`: pure game logic (draft, scoring), shared by the
  functions and the app (`@core/...`). No dependencies; imports use `.ts` extensions.
- `tests/`: Vitest unit tests for the core.

## Commands (repo root)

```bash
npm test                        # core unit tests
npm run typecheck               # core + app
npx supabase start              # local Supabase (needs Docker)
npx supabase functions serve    # local Edge Functions (keep running)
npm run test:int                # resets local DB, runs a full draft end to end
npx tsx scripts/seed-local.ts   # after `supabase db reset`: 7 test managers + player pool
```

Run the app locally against local Supabase (key from `npx supabase status`):

```bash
cd app && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=<publishable key> \
  EXPO_PUBLIC_APP_ENV=local npx expo start --web
```

Locally the sign-in screen has a dev sign-in: `<manager>@example.com`, password `password123`
(e.g. `daniel@example.com`, the commissioner).

## Workflow

Changes reach users like this. Follow it for every change:

1. Work on a new branch. Never push to `main` directly.
2. Run `npm test`, `npm run typecheck`, and `cd app && npx expo lint` before pushing.
3. Open a PR and enable auto-merge (`gh pr merge --auto --squash`). When CI passes it
   merges and deploys to **staging** automatically.
4. Production deploys only after the repo owner approves the `production` environment
   in GitHub Actions. Never try to bypass or weaken that gate.

Rule changes: update `docs/RULES.md` in the same PR as the code, and add tests in
`tests/` for any change to draft or scoring logic.
