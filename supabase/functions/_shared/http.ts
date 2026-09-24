export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** An error whose message is safe to show the user. */
export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Wraps a handler with CORS preflight and error-to-JSON handling. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong.' }, 500);
    }
  });
}
