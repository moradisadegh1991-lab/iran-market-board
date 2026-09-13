'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * A price that rolls its changed digits vertically, the way the mechanical rate boards
 * in a صرافی window flip when a rate moves. Only the digits that actually changed move,
 * so the eye is drawn to the part that is new rather than to the whole number.
 *
 * Digits are pre-rendered as a 0–9 column and shifted with a transform, so there is no
 * layout work per frame. Respects prefers-reduced-motion (then it just swaps).
 */
export default function RollingNumber({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const prev = useRef(text);
  const [moved, setMoved] = useState<boolean[]>([]);

  useEffect(() => {
    if (text === prev.current) return;
    const before = prev.current;
    // mark which character positions differ, aligned from the right (ones place)
    const flags: boolean[] = [];
    for (let i = 0; i < text.length; i++) {
      const b = before[before.length - text.length + i];
      flags.push(b !== text[i]);
    }
    prev.current = text;
    setShown(text);
    setMoved(flags);
    const t = setTimeout(() => setMoved([]), 900);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <span className={className} aria-label={shown}>
      {shown.split('').map((ch, i) => {
        const isDigit = /[0-9٠-٩۰-۹]/.test(ch);
        if (!isDigit) return <span key={i} className="rn-sep" aria-hidden="true">{ch}</span>;
        return (
          <span key={i} className={`rn-digit${moved[i] ? ' rolling' : ''}`} aria-hidden="true">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
