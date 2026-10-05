// From Kasbai (moradisadegh1991-lab/final-project, lib/qrcode.ts), unchanged.
// ══════════════════════════════════════════════════════════════
// تولیدکننده‌ی QR کاملاً خودکفا — بدون هیچ وابستگی npm.
//
// چرا از صفر نوشته شده: سرور کسب‌ای به npm دسترسی ندارد (شبکه بسته
// است)، پس نصب کتابخانه‌ی qrcode ممکن نیست. استفاده از سرویس‌های
// تصویر QR خارجی هم ریسک دارد (از ایران ممکن است بلاک/کند باشد و
// آدرس فروشگاه کاسب به سرور ثالث می‌رود).
//
// پوشش: QR مدل ۲، حالت Byte، سطح تصحیح خطا M (~۱۵٪ بازیابی — برای
// چاپ روی برچسب/استند مناسب است)، نسخه‌های ۱ تا ۱۰ (تا ۲۱۳ کاراکتر،
// خیلی بیشتر از یک URL).
// ══════════════════════════════════════════════════════════════

// ── جدول ظرفیت و ساختار بلوک برای سطح M ──
// [کل codeword، ECC هر بلوک، [تعداد بلوک × data codeword]]
const VERSIONS: { total: number; ecc: number; blocks: [number, number][] }[] = [
  { total: 26,  ecc: 10, blocks: [[1, 16]] },                 // v1
  { total: 44,  ecc: 16, blocks: [[1, 28]] },                 // v2
  { total: 70,  ecc: 26, blocks: [[1, 44]] },                 // v3
  { total: 100, ecc: 18, blocks: [[2, 32]] },                 // v4
  { total: 134, ecc: 24, blocks: [[2, 43]] },                 // v5
  { total: 172, ecc: 16, blocks: [[4, 27]] },                 // v6
  { total: 196, ecc: 18, blocks: [[4, 31]] },                 // v7
  { total: 242, ecc: 22, blocks: [[2, 38], [2, 39]] },        // v8
  { total: 292, ecc: 22, blocks: [[3, 36], [2, 37]] },        // v9
  { total: 346, ecc: 26, blocks: [[4, 43], [1, 44]] },        // v10
];

const ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// ── حسابان میدان گالوا GF(256) برای Reed-Solomon ──
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // چندجمله‌ای مولد QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gmul = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= poly[i];
      next[i + 1] ^= gmul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGenerator(eccLen);
  const res = new Uint8Array(eccLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[eccLen - 1] = 0;
    for (let i = 0; i < eccLen; i++) res[i] ^= gmul(gen[i + 1], factor);
  }
  return res;
}

// ── انتخاب نسخه بر اساس طول داده ──
function pickVersion(len: number): number {
  for (let v = 0; v < VERSIONS.length; v++) {
    const cap = VERSIONS[v].blocks.reduce((s, [n, d]) => s + n * d, 0);
    // سرآمد: ۴ بیت حالت + شمارنده طول (۸ بیت برای v1-9، ۱۶ بیت برای v10+)
    const headerBits = 4 + (v + 1 >= 10 ? 16 : 8);
    if (Math.ceil((headerBits + len * 8) / 8) <= cap) return v + 1;
  }
  throw new Error("متن برای QR نسخه ۱۰ خیلی بلند است");
}

// ── ساخت جریان بیت داده ──
function buildData(text: string, version: number): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const info = VERSIONS[version - 1];
  const dataCap = info.blocks.reduce((s, [n, d]) => s + n * d, 0);

  const bits: number[] = [];
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  push(0b0100, 4);                              // حالت Byte
  push(bytes.length, version >= 10 ? 16 : 8);   // شمارنده طول
  for (const b of bytes) push(b, 8);

  // خاتمه‌دهنده (حداکثر ۴ بیت) + پرکردن تا مضرب ۸
  const capBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(dataCap);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out[i / 8] = byte;
  }
  // بایت‌های پرکننده استاندارد
  const PAD = [0xec, 0x11];
  for (let i = bits.length / 8, k = 0; i < dataCap; i++, k++) out[i] = PAD[k % 2];
  return out;
}

// ── درهم‌آمیزی بلوک‌های داده و ECC ──
function interleave(data: Uint8Array, version: number): Uint8Array {
  const info = VERSIONS[version - 1];
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let pos = 0;
  for (const [count, size] of info.blocks) {
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(pos, pos + size);
      pos += size;
      dataBlocks.push(chunk);
      eccBlocks.push(rsEncode(chunk, info.ecc));
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < info.ecc; i++) {
    for (const b of eccBlocks) out.push(b[i]);
  }
  return new Uint8Array(out);
}

// ── چیدمان ماتریس ──
type Grid = (0 | 1 | null)[][];

function placeFunctionPatterns(g: Grid, size: number, version: number) {
  const finder = (r: number, c: number) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = i >= 0 && i <= 6 && j >= 0 && j <= 6 &&
          (i === 0 || i === 6 || j === 0 || j === 6 ||
           (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        g[rr][cc] = inRing ? 1 : 0;
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // الگوهای زمان‌بندی
  for (let i = 8; i < size - 8; i++) {
    const v: 0 | 1 = i % 2 === 0 ? 1 : 0;
    if (g[6][i] === null) g[6][i] = v;
    if (g[i][6] === null) g[i][6] = v;
  }

  // الگوهای تنظیم
  const centers = ALIGN[version - 1];
  for (const r of centers) {
    for (const c of centers) {
      if (g[r][c] !== null) continue; // با finder تلاقی دارد
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          g[r + i][c + j] =
            Math.max(Math.abs(i), Math.abs(j)) === 1 ? 0 : 1;
        }
      }
    }
  }

  g[size - 8][8] = 1; // ماژول تیره‌ی ثابت
}

function reserveFormatAreas(g: Grid, size: number, version: number) {
  for (let i = 0; i < 9; i++) {
    if (g[8][i] === null) g[8][i] = 0;
    if (g[i][8] === null) g[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (g[8][size - 1 - i] === null) g[8][size - 1 - i] = 0;
    if (g[size - 1 - i][8] === null) g[size - 1 - i][8] = 0;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        if (g[size - 11 + j][i] === null) g[size - 11 + j][i] = 0;
        if (g[i][size - 11 + j] === null) g[i][size - 11 + j] = 0;
      }
    }
  }
}

function placeData(g: Grid, size: number, codewords: Uint8Array) {
  let bitIdx = 0;
  const nextBit = (): 0 | 1 => {
    const byte = codewords[bitIdx >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIdx & 7))) & 1;
    bitIdx++;
    return bit as 0 | 1;
  };
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // ستون زمان‌بندی را رد کن
    for (let n = 0; n < size; n++) {
      const row = upward ? size - 1 - n : n;
      for (const c of [col, col - 1]) {
        if (g[row][c] === null) g[row][c] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function isFunctionModule(size: number, version: number, r: number, c: number): boolean {
  if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) return true;
  if (r === 6 || c === 6) return true;
  if (version >= 7) {
    if (r < 6 && c >= size - 11) return true;
    if (c < 6 && r >= size - 11) return true;
  }
  const centers = ALIGN[version - 1];
  for (const ar of centers) {
    for (const ac of centers) {
      if ((ar < 9 && ac < 9) || (ar < 9 && ac > size - 10) || (ar > size - 10 && ac < 9)) continue;
      if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
    }
  }
  return false;
}

function penalty(m: (0 | 1)[][], size: number): number {
  let score = 0;
  // قاعده ۱: ردیف/ستون‌های یک‌رنگ ۵+
  const runScore = (line: (0 | 1)[]) => {
    let s = 0, run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) s += 3 + (run - 5);
    return s;
  };
  for (let i = 0; i < size; i++) {
    score += runScore(m[i]);
    score += runScore(m.map((row) => row[i]));
  }
  // قاعده ۲: بلوک‌های ۲×۲ یک‌رنگ
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  // قاعده ۳: الگوی شبیه finder (۱:۱:۳:۱:۱ با ۴ سفید)
  const PAT = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (line: (0 | 1)[], i: number) => {
    for (let k = 0; k < 7; k++) if (line[i + k] !== PAT[k]) return false;
    const before = line.slice(Math.max(0, i - 4), i);
    const after = line.slice(i + 7, i + 11);
    return (before.length === 4 && before.every((x) => x === 0)) ||
           (after.length === 4 && after.every((x) => x === 0));
  };
  for (let i = 0; i < size; i++) {
    const row = m[i], col = m.map((r) => r[i]);
    for (let j = 0; j + 7 <= size; j++) {
      if (hasPattern(row, j)) score += 40;
      if (hasPattern(col, j)) score += 40;
    }
  }
  // قاعده ۴: انحراف نسبت ماژول‌های تیره از ۵۰٪
  let dark = 0;
  for (const row of m) for (const v of row) dark += v;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function formatBits(mask: number): number {
  // سطح M = 00
  let data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** متن را به ماتریس QR (آرایه‌ی دوبعدی ۰/۱) تبدیل می‌کند. */
export function qrMatrix(text: string): (0 | 1)[][] {
  const version = pickVersion(new TextEncoder().encode(text).length);
  const size = version * 4 + 17;
  const codewords = interleave(buildData(text, version), version);

  const grid: Grid = Array.from({ length: size }, () => new Array(size).fill(null));
  placeFunctionPatterns(grid, size, version);
  reserveFormatAreas(grid, size, version);
  placeData(grid, size, codewords);

  // انتخاب بهترین ماسک
  let best: (0 | 1)[][] | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m: (0 | 1)[][] = grid.map((row, r) =>
      row.map((v, c) => {
        const base = (v ?? 0) as 0 | 1;
        if (isFunctionModule(size, version, r, c)) return base;
        return (MASKS[mask](r, c) ? (base ^ 1) : base) as 0 | 1;
      })
    );
    applyFormat(m, size, version, mask);
    const s = penalty(m, size);
    if (s < bestScore) { bestScore = s; best = m; bestMask = mask; }
  }
  void bestMask;
  return best!;
}

function applyFormat(m: (0 | 1)[][], size: number, version: number, mask: number) {
  const fmt = formatBits(mask);
  // نکته‌ی حیاتی: مختصات دقیقاً طبق ISO/IEC 18004 — قبلاً سطر و ستون
  // جابه‌جا نوشته شده بود که بیت‌های format را خراب می‌کرد و در نتیجه
  // انتخاب ماسک هم غلط می‌شد (اسکنر نمی‌توانست بخواند).
  for (let i = 0; i < 15; i++) {
    const bit = ((fmt >> i) & 1) as 0 | 1;
    // کپی اول — ستون ۸ / ردیف ۸ اطراف finder بالا-چپ
    if (i < 6) m[i][8] = bit;
    else if (i === 6) m[7][8] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[8][7] = bit;
    else m[8][14 - i] = bit;
    // کپی دوم — پایین-چپ و بالا-راست
    if (i < 8) m[8][size - 1 - i] = bit;
    else m[size - 15 + i][8] = bit;
  }
  m[size - 8][8] = 1; // ماژول تیره‌ی ثابت

  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >> i) & 1) as 0 | 1;
      const r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = bit;
      m[r][size - 11 + c] = bit;
    }
  }
}

/**
 * QR را به‌صورت SVG برمی‌گرداند — مقیاس‌پذیر، برای چاپ عالی، و
 * بدون نیاز به canvas یا تصویر خارجی.
 */
export function qrSvg(text: string, opts: { size?: number; margin?: number; dark?: string; light?: string } = {}): string {
  const m = qrMatrix(text);
  const n = m.length;
  const margin = opts.margin ?? 4;
  const total = n + margin * 2;
  const px = opts.size ?? 256;
  const dark = opts.dark ?? "#17201d";
  const light = opts.light ?? "#ffffff";

  // مسیرهای افقی به‌هم‌چسبیده — SVG کوچک‌تر و رندر سریع‌تر
  let path = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (m[r][c] === 1) {
        let len = 1;
        while (c + len < n && m[r][c + len] === 1) len++;
        path += `M${c + margin} ${r + margin}h${len}v1h-${len}z`;
        c += len;
      } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="کد QR"><rect width="${total}" height="${total}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
