import postgres from 'npm:postgres@3.4.7';

// Direct Postgres connection so draft actions can run in a locked transaction.
// SUPABASE_DB_URL is provided to Edge Functions automatically.
export const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });

export type Tx = postgres.TransactionSql;
