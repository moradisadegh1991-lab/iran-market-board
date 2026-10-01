'use client';
import { Fragment } from 'react';

/**
 * The tiny subset of Markdown the advisor is told to use: paragraphs, **bold**, bullet / numbered
 * lists, ### headings and one pipe table. Rendered as React elements — never as HTML — so nothing
 * in a model answer can inject markup.
 */
function inline(s: string, key: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={`${key}-${i}`}>{p.slice(2, -2)}</b> : <Fragment key={`${key}-${i}`}>{p}</Fragment>));
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `l${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div className="table-scroll" key={k}>
          <table className="t fin-md-table">
            <thead>
              <tr>{head?.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${k}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        i++;
      }
      const L = ordered ? 'ol' : 'ul';
      out.push(
        <L key={k}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${k}i${j}`)}</li>
          ))}
        </L>,
      );
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      out.push(<h3 key={k}>{inline(h[1], k)}</h3>);
      i++;
      continue;
    }
    out.push(<p key={k}>{inline(line, k)}</p>);
    i++;
  }
  return <div className="fin-md">{out}</div>;
}
