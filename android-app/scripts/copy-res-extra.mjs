/**
 * Copies hand-made Android resources that the generators do not produce into the generated
 * project: the status-bar notification icon `ic_stat_mali` (white silhouette, one per density).
 * capacitor.config.json names it as LocalNotifications.smallIcon — a smallIcon that is missing
 * from the app's resources is exactly how notifications silently failed before (CLAUDE.md rule 14),
 * so this fails loudly when anything is missing.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'res-extra';
const dst = join('android', 'app', 'src', 'main', 'res');
if (!existsSync(dst)) {
  console.error('android/ not found — run `npx cap add android` first.');
  process.exit(1);
}
const dirs = readdirSync(src);
for (const d of dirs) cpSync(join(src, d), join(dst, d), { recursive: true });
const want = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].map((d) => join(dst, `drawable-${d}`, 'ic_stat_mali.png'));
const missing = want.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('missing notification icon:', missing.join(', '));
  process.exit(1);
}
console.log(`copied ${dirs.length} resource folders (ic_stat_mali in ${want.length} densities)`);
