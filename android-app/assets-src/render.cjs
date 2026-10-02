// Renders assets-src/*.svg to the PNGs @capacitor/assets and res-extra need (uses Chromium via
// playwright, installed only for this: npm i --no-save playwright). Run: node android-app/assets-src/render.cjs
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(ROOT + '/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SRC = __dirname;
const svg = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const data = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const shot = async (html, w, h, out, transparent = false) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#fff'}">${html}</body></html>`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p.screenshot({ path: out, omitBackground: transparent });
    await p.close();
  };
  const A = ROOT + '/android-app/assets';
  const bg = data(svg('background.svg')), fg = data(svg('foreground.svg')), nt = data(svg('notification.svg'));
  const layer = (src, s) => `<img src="${src}" style="position:absolute;inset:0;width:${s}px;height:${s}px">`;
  await shot(`<div style="position:relative;width:1024px;height:1024px">${layer(bg, 1024)}</div>`, 1024, 1024, A + '/icon-background.png');
  await shot(`<div style="position:relative;width:1024px;height:1024px">${layer(fg, 1024)}</div>`, 1024, 1024, A + '/icon-foreground.png', true);
  await shot(`<div style="position:relative;width:1024px;height:1024px">${layer(bg, 1024)}${layer(fg, 1024)}</div>`, 1024, 1024, A + '/icon-only.png');
  // splash: the coin on the brand background
  const sp = `<div style="position:relative;width:1600px;height:1600px;background:#1a2848"><img src="${fg}" style="position:absolute;left:500px;top:500px;width:600px;height:600px"></div>`;
  await shot(sp, 1600, 1600, A + '/splash.png');
  await shot(sp, 1600, 1600, A + '/splash-dark.png');
  // status-bar notification icon, per density
  for (const [d, s] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]])
    await shot(`<img src="${nt}" style="width:${s}px;height:${s}px;display:block">`, s, s, `${ROOT}/android-app/res-extra/drawable-${d}/ic_stat_mali.png`, true);
  // preview: launcher masks (circle, squircle) at phone size + the status icon on a dark bar
  const prev = (r) => `<div style="position:relative;width:192px;height:192px;border-radius:${r};overflow:hidden;display:inline-block;margin:18px">${layer(bg, 192)}<img src="${fg}" style="position:absolute;left:-24px;top:-24px;width:240px;height:240px"></div>`;
  await shot(`<div style="background:#e8e2d8;padding:20px;width:780px">${prev('50%')}${prev('28%')}${prev('8%')}<div style="display:inline-block;background:#1f1f1f;padding:12px 18px;border-radius:10px"><img src="${nt}" style="width:48px;height:48px;filter:invert(0)"></div></div>`, 820, 250, require('os').tmpdir() + '/icon-preview.png');
  await b.close();
  console.log('rendered');
})();
