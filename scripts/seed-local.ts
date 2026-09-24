// Seeds local Supabase with the 7 managers as test users (password: password123), each
// claiming their team, and syncs the player pool. Run after `npx supabase db reset`:
//   npx tsx scripts/seed-local.ts
import { execSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }));
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const SEASON_ID = '7ba99e70-0000-4000-8000-000000002026';
const TEAM_IDS = [139, 147, 111, 114, 117, 145, 144, 158, 119, 143, 112, 135];

for (const name of ['Alex', 'Curtis', 'Daniel', 'Darren', 'James', 'Kyle', 'Mookie']) {
  const email = `${name.toLowerCase()}@example.com`;
  await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true, user_metadata: { full_name: name } });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: 'password123' });
  const { data: team } = await admin.from('fantasy_teams').select('id').eq('season_id', SEASON_ID).eq('manager_name', name).single();
  await client.rpc('claim_team', { p_team_id: team!.id });
  if (name === 'Daniel') {
    const { error } = await client.functions.invoke('sync-pool', { body: { seasonId: SEASON_ID, teamIds: TEAM_IDS } });
    if (error) throw error;
  }
}
console.log('Seeded 7 managers and the player pool.');
