// Where the client talks to the server.
//
// On the website the API is same-origin, so paths stay relative. Inside the Android app the
// pages are bundled into the APK (scripts/build-app-web.mjs) and load from https://localhost,
// so every call goes to the deployment named by NEXT_PUBLIC_API_BASE — inlined at build time.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '').replace(/\/$/, '');

/** true only in the APK build */
export const IN_APP = process.env.NEXT_PUBLIC_IN_APP === '1';

export const api = (path: string) => `${API_BASE}${path}`;
