import { createClient } from 'npm:@supabase/supabase-js@2';

import { sql } from './db.ts';
import { UserError } from './http.ts';

/**
 * The signed-in user's id, from the request's Authorization header. getClaims verifies the
 * token's signature and expiry locally against the project's cached signing keys, which
 * saves a round trip to the Auth server on every request.
 */
export async function requireUser(req: Request): Promise<string> {
  const authorization = req.headers.get('Authorization');
  if (!authorization) throw new UserError('Not signed in.', 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await supabase.auth.getClaims(authorization.replace(/^Bearer /, ''));
  if (error || !data?.claims.sub) throw new UserError('Not signed in.', 401);
  return data.claims.sub;
}

export async function isCommissioner(seasonId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from seasons s join league_members m on m.league_id = s.league_id
    where s.id = ${seasonId} and m.user_id = ${userId} and m.role = 'commissioner'`;
  return rows.length > 0;
}

export async function requireCommissioner(seasonId: string, userId: string): Promise<void> {
  if (!(await isCommissioner(seasonId, userId))) {
    throw new UserError('Only the commissioner can do that.', 403);
  }
}
