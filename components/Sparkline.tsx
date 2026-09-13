export default function Sparkline({
  data,
  width = 84,
  height = 26,
  label = 'روند ۷ روزه',
  /** when set, the line uses this colour instead of being tinted by its own direction —
   *  use it where a differently-timed change% sits alongside, so the two don't contradict */
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  label?: string;
  color?: string;
}) {
  if (!data || data.length < 2) return <span className="muted small">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  const rising = data[data.length - 1] >= data[0];
  const stroke = color ?? (rising ? 'var(--up)' : 'var(--down)');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${rising ? 'صعودی' : 'نزولی'}`}
      style={{ direction: 'ltr' }}
    >
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
