/**
 * The app's one icon set and its illustrations (rule 89): every page in the menu has a Lucide icon, every built-in
 * category has one (a user's own category keeps its emoji), every illustration a page asks for is in public/art, and
 * each is a plain drawing — nothing that runs, nothing fetched from elsewhere — in the app's teal, not unDraw's purple.
 * Run: npx tsx scripts/ui-test.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as Lucide from 'lucide-react';
import { NAV_GROUPS } from '../components/nav';
import { BIZ_CATEGORIES, DEFAULT_CATEGORIES } from '../lib/finance/model';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`✓ ${name}`);
};
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'components/icons.tsx'), 'utf8');
const block = (name: string) => src.slice(src.indexOf(`export const ${name}`), src.indexOf('};', src.indexOf(`export const ${name}`)));
const entries = (name: string) => Object.fromEntries([...block(name).matchAll(/'([^']+)':\s*(\w+),/g)].map((m) => [m[1], m[2]]));

ok('every page in the menu has an icon, and each icon exists in lucide-react', () => {
  const icons = entries('PAGE_ICON');
  for (const g of NAV_GROUPS) for (const p of g.items) {
    assert.ok(icons[p.href], `no icon for ${p.href}`);
    assert.ok((Lucide as Record<string, unknown>)[icons[p.href]], `${icons[p.href]} is not a Lucide icon`);
  }
});

ok('every built-in category has an icon', () => {
  const icons = entries('CATEGORY_ICON');
  for (const c of [...DEFAULT_CATEGORIES, ...BIZ_CATEGORIES]) {
    assert.ok(icons[c.id], `no icon for ${c.id}`);
    assert.ok((Lucide as Record<string, unknown>)[icons[c.id]], `${icons[c.id]} is not a Lucide icon`);
  }
});

ok('every illustration used is in public/art; each is a clean drawing in the app’s colors', () => {
  const keys = [...src.matchAll(/export type (?:ArtKey|LessonArt) = ([^;]+);/g)].flatMap((m) => m[1].match(/'(\w+)'/g)!.map((k) => k.slice(1, -1)));
  const used = new Set<string>();
  // lessons name theirs in lib/learn/lessons.ts
  for (const m of fs.readFileSync(path.join(ROOT, 'lib/learn/lessons.ts'), 'utf8').matchAll(/\bart: '(\w+)'/g)) used.add(m[1]);
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.tsx$/.test(f.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b(?:art|k)="(\w+)"/g)) used.add(m[1]);
    }
  };
  walk(path.join(ROOT, 'components'));
  walk(path.join(ROOT, 'app'));
  for (const k of used) if (keys.includes(k)) assert.ok(fs.existsSync(path.join(ROOT, 'public/art', `${k}.svg`)), `public/art/${k}.svg missing`);
  for (const f of fs.readdirSync(path.join(ROOT, 'public/art'))) {
    const svg = fs.readFileSync(path.join(ROOT, 'public/art', f), 'utf8');
    assert.ok(keys.includes(f.replace(/\.svg$/, '')) && used.has(f.replace(/\.svg$/, '')), `${f} is not used`);
    assert.ok(svg.startsWith('<svg'), f);
    assert.ok(!/<script|<foreignObject|<image|\son\w+=|javascript:|href="http|url\((?!#)/i.test(svg), `${f}: something that runs or loads`);
    assert.ok(!/#6c63ff/i.test(svg) && /#0d7377/i.test(svg), `${f}: not recolored`);
    assert.ok(svg.length < 40_000, `${f}: ${svg.length} bytes`);
  }
});

console.log(`\nui: ${n} checks OK`);
