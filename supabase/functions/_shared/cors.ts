// CORS headers for browser callers (supabase-js `functions.invoke` sends an
// Authorization + apikey + content-type POST, which triggers a preflight). The
// OPTIONS preflight must return these headers or the browser blocks the POST;
// every real response carries them too so the browser can read the body.
//
// Allowed origins come from the ALLOWED_ORIGINS secret (comma-separated), set
// per Supabase branch (prod site on prod, dev site + localhost on dev). When the
// var is unset (local/unconfigured) we echo the request origin and warn, so
// nothing breaks before origins are configured.
const BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

function resolveAllowOrigin(origin: string | null): string | null {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (!raw) {
    if (origin) console.warn('ALLOWED_ORIGINS unset; echoing request origin', origin);
    return origin;
  }
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const allow = resolveAllowOrigin(req.headers.get('Origin'));
  return allow ? { ...BASE, 'Access-Control-Allow-Origin': allow } : { ...BASE };
}
