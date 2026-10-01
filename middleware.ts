import { NextResponse, type NextRequest } from 'next/server';

/**
 * The Android app is a Capacitor shell: its pages load from capacitor://localhost or
 * http://localhost, so every call it makes to this API is cross-origin. Without these headers
 * the browser blocks the response and the app shows empty screens with no visible error.
 *
 * Only the read-only endpoints are opened up. Anything that changes state (paper trading,
 * holdings, telegram, ingest) still requires ADMIN_SECRET and is deliberately left out, so a
 * page on some other site cannot drive the account by silently calling these from a browser.
 *
 * `/api/live/local` is on this list because it is stateless: it advances a session the caller
 * sends and hands it straight back, touching no stored session. The shared `/api/paper` — which
 * does write to Redis — stays closed.
 *
 * `/api/advisor` is here for the same reason: it stores nothing the caller sends (only a per-day
 * call counter). Because each call spends the Anthropic key, it additionally requires the
 * `x-advisor-secret` header, which is why that header is allowed below.
 */
const READ_ONLY = ['/api/snapshot', '/api/chart', '/api/swing', '/api/simulate', '/api/live/local', '/api/advisor'];

/**
 * GET-only: the shared live session, the swing live session and the holdings list are already
 * public on the website (their GET needs no secret). The app shows them read-only; their POST —
 * which changes server state — stays closed to cross-origin callers, and the app hides those
 * forms (components/ui.tsx `AdminActions`).
 */
const GET_ONLY = ['/api/paper', '/api/swing-live', '/api/holdings'];

const matches = (list: string[], pathname: string) => list.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // exact paths only: /api/paper/tick and /api/swing-live/tick advance sessions and stay closed
  if (req.method === 'GET' && GET_ONLY.includes(pathname)) {
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  }
  if (!matches(READ_ONLY, pathname)) return NextResponse.next();

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-advisor-secret',
    'Access-Control-Max-Age': '86400',
  };
  // the browser sends a preflight before any POST with a JSON body
  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: '/api/:path*' };
