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
 */
const READ_ONLY = ['/api/snapshot', '/api/chart', '/api/swing', '/api/simulate', '/api/live/local'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!READ_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  // the browser sends a preflight before any POST with a JSON body
  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: '/api/:path*' };
