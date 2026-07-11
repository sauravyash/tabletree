// CORS headers for browser callers (supabase-js `functions.invoke` sends an
// Authorization + apikey + content-type POST, which triggers a preflight). The
// OPTIONS preflight must return these headers or the browser blocks the POST;
// every real response carries them too so the browser can read the body.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
