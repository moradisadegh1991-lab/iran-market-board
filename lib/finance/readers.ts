// Reading a statement FILE into cells — runs in the browser only; the file never leaves the device
// (CLAUDE.md rule 7). The libraries are loaded on demand so the rest of the app does not carry
// SheetJS or pdf.js. Parsing of the cells lives in ./importers.ts.
import { parseCsv, type PdfItem, tableFromPdf } from './importers';

export type StatementFormat = 'excel' | 'csv' | 'pdf';

export class ReadError extends Error {
  constructor(message: string, readonly code: 'password' | 'empty' | 'format' = 'format') {
    super(message);
  }
}

export function formatOf(name: string): StatementFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'htm', 'html'].includes(ext)) return 'excel';
  return null;
}

/** Iranian bank CSVs are UTF-8 or Windows-1256; try the strict one first. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1256').decode(buf);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
function cellText(v: unknown): string {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return v == null ? '' : String(v);
}

/** Workbook → the sheet with the most filled rows, as text cells. */
export async function tableFromWorkbook(buf: ArrayBuffer): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  let best: string[][] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    const table = rows.map((r) => r.map(cellText));
    if (table.length > best.length) best = table;
  }
  return best;
}

interface PdfTextItem { str: string; transform: number[]; width: number }

/** PDF → positioned words → table. Bank PDFs protected with a password (often the national code) are supported. */
export async function tableFromPdfFile(buf: ArrayBuffer, password?: string): Promise<{ table: string[][]; pages: number }> {
  // the legacy build: the default one needs Promise.try, missing from older Android WebViews and
  // Samsung Internet versions still on phones
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Run pdf.js in this thread instead of a Worker: statements are a few pages, and this avoids
  // depending on how the bundler serves the worker file.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), password });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as { name?: string })?.name === 'PasswordException')
      throw new ReadError(password ? 'رمز PDF درست نیست.' : 'این PDF رمز دارد. رمز را وارد کنید (معمولاً کد ملی یا شماره مشتری).', 'password');
    throw new ReadError('فایل PDF خوانده نشد؛ ممکن است خراب باشد.');
  }
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(
      (tc.items as PdfTextItem[])
        .filter((it) => typeof it.str === 'string' && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })),
    );
  }
  await task.destroy();
  if (!pages.some((p) => p.length))
    throw new ReadError('در این PDF متنی نیست (احتمالاً تصویر اسکن‌شده است). نسخه اکسل یا PDF متنی را از اینترنت‌بانک بگیرید.', 'empty');
  return { table: tableFromPdf(pages), pages: pages.length };
}

export async function readStatement(name: string, buf: ArrayBuffer, password?: string): Promise<{ table: string[][]; format: StatementFormat; pages?: number }> {
  const format = formatOf(name);
  if (!format) throw new ReadError('فقط فایل اکسل (xlsx/xls)، CSV یا PDF.');
  if (format === 'csv') return { table: parseCsv(decodeText(buf)), format };
  if (format === 'excel') return { table: await tableFromWorkbook(buf), format };
  const r = await tableFromPdfFile(buf, password);
  return { ...r, format };
}
