import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { corsHeaders } from './cors.ts';

function reqWithOrigin(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  return new Request('https://fn.example/x', { method: 'OPTIONS', headers });
}

Deno.test('echoes an allowed origin when ALLOWED_ORIGINS is set', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example,https://dev--app.netlify.app');
  const h = corsHeaders(reqWithOrigin('https://dev--app.netlify.app'));
  assertEquals(h['Access-Control-Allow-Origin'], 'https://dev--app.netlify.app');
  assertEquals(h['Vary'], 'Origin');
  Deno.env.delete('ALLOWED_ORIGINS');
});

Deno.test('omits Allow-Origin for a disallowed origin when list is set', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example');
  const h = corsHeaders(reqWithOrigin('https://evil.example'));
  assertEquals(h['Access-Control-Allow-Origin'], undefined);
  Deno.env.delete('ALLOWED_ORIGINS');
});

Deno.test('falls back to echoing origin when ALLOWED_ORIGINS is unset', () => {
  Deno.env.delete('ALLOWED_ORIGINS');
  const h = corsHeaders(reqWithOrigin('http://localhost:5173'));
  assertEquals(h['Access-Control-Allow-Origin'], 'http://localhost:5173');
});
