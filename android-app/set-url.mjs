/**
 * Writes the deployment URL into the bundle so the same www/ can point at any server.
 *   node set-url.mjs https://your-app.vercel.app
 * Run this BEFORE `npx cap sync android`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const url = (process.argv[2] || process.env.BOARD_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[\w.-]+/.test(url)) {
  console.error('usage: node set-url.mjs https://your-app.vercel.app');
  console.error('(https is required — Android blocks cleartext http by default)');
  process.exit(1);
}
const file = 'www/index.html';
let html = readFileSync(file, 'utf8');
const tag = `<script>window.BOARD_URL=${JSON.stringify(url)};</script>`;
html = html.includes('window.BOARD_URL=')
  ? html.replace(/<script>window\.BOARD_URL=[^<]*<\/script>/, tag)
  : html.replace('</head>', `${tag}\n</head>`);
writeFileSync(file, html);
console.log(`BOARD_URL set to ${url}`);
