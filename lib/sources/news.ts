// Historical news that is reachable from Vercel without API keys.
//  • Google News RSS search supports `after:` / `before:` operators → date-bounded headlines for any past month.
//  • GDELT DOC 2.0 API (English, rolling ~3-month window) is the fallback when Google refuses a datacenter IP.
import { fetchJson, fetchText } from '@/lib/http';

export interface RawNews {
  title: string;
  source: string;
  url: string;
  ms: number; // publish time (epoch ms)
  lang: 'fa' | 'en';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]) : '';
};

/** Parse a Google News RSS document. Titles arrive as "Headline - Source"; the source suffix is stripped. */
export function parseGoogleNewsRss(xml: string, lang: 'fa' | 'en'): RawNews[] {
  const out: RawNews[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const source = tag(block, 'source');
    let title = tag(block, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const ms = Date.parse(tag(block, 'pubDate'));
    const url = tag(block, 'link');
    if (title && Number.isFinite(ms)) out.push({ title, source: source || 'Google News', url, ms, lang });
  }
  return out;
}

/** after/before are YYYY-MM-DD (before is exclusive in Google's operator semantics). */
export async function fetchGoogleNews(query: string, after: string, before: string, lang: 'fa' | 'en'): Promise<RawNews[]> {
  const q = encodeURIComponent(`${query} after:${after} before:${before}`);
  const locale = lang === 'fa' ? 'hl=fa&gl=IR&ceid=IR:fa' : 'hl=en-US&gl=US&ceid=US:en';
  const xml = await fetchText(`https://news.google.com/rss/search?q=${q}&${locale}`, { timeoutMs: 12_000, retries: 1 });
  if (!/<rss|<feed/i.test(xml)) throw new Error('Google News: not an RSS document');
  return parseGoogleNewsRss(xml, lang);
}

/** GDELT seendate "20250314T101500Z" → epoch ms */
const gdeltMs = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};

export async function fetchGdeltNews(query: string, after: string, before: string): Promise<RawNews[]> {
  const d = (iso: string) => iso.replace(/-/g, '');
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${query} sourcelang:english`)}` +
    `&mode=ArtList&format=json&maxrecords=75&sort=HybridRel&startdatetime=${d(after)}000000&enddatetime=${d(before)}000000`;
  const json = await fetchJson<{ articles?: { url: string; title: string; seendate: string; domain: string }[] }>(url, { timeoutMs: 12_000, retries: 0 });
  return (json.articles ?? [])
    .map((a) => ({ title: decodeEntities(a.title ?? ''), source: a.domain ?? 'GDELT', url: a.url, ms: gdeltMs(a.seendate ?? ''), lang: 'en' as const }))
    .filter((a) => a.title && Number.isFinite(a.ms));
}
