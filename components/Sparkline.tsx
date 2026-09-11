export default function Sparkline({ data, width = 84, height = 26 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return <span className="muted small">—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const rising = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={rising ? 'روند ۷ روزه صعودی' : 'روند ۷ روزه نزولی'} style={{ direction: 'ltr' }}>
      <polyline points={pts} fill="none" stroke={rising ? 'var(--up)' : 'var(--down)'} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
