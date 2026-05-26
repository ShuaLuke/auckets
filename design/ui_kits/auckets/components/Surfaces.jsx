// =============================================================
// AUCKETS UI Kit — Badge & Card primitives
// =============================================================

const badgePalettes = {
  placed:   { bg: '#EEF3EE', fg: '#163823', dot: '#1F4A2E' },
  preview:  { bg: '#F6E6CC', fg: '#8F6A2A', dot: '#C99A4B' },
  pending:  { bg: '#F6E6CC', fg: '#8F6A2A', dot: '#C99A4B' },
  skipped:  { bg: '#E8E6DE', fg: '#46443B', dot: '#6B6759' },
  unplaced: { bg: '#F2D9D3', fg: '#722417', dot: '#A93C2A' },
  open:     { bg: '#F6E6CC', fg: '#8F6A2A', dot: '#C99A4B' },
  upcoming: { bg: '#E8E6DE', fg: '#46443B', dot: '#6B6759' },
  inverse:  { bg: '#0E0F0C', fg: '#F4F1E8', dot: '#F4F1E8' },
};

const Badge = ({ tone = 'placed', dot = true, children, style }) => {
  const p = badgePalettes[tone] || badgePalettes.placed;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      background: p.bg, color: p.fg,
      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
      letterSpacing: '0.02em', whiteSpace: 'nowrap',
      ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: p.dot }} />}
      {children}
    </span>
  );
};

const Tag = ({ children, tone = 'neutral', style }) => {
  const tones = {
    neutral: { bg: '#E8E6DE', fg: '#1C1B17' },
    brand:   { bg: '#D5E2D5', fg: '#163823' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 8px', borderRadius: 4,
      fontFamily: 'var(--font-mono)', fontSize: 11,
      background: t.bg, color: t.fg, ...style,
    }}>{children}</span>
  );
};

const Card = ({ variant = 'default', children, style, ...rest }) => {
  const variants = {
    default:  { background: '#FFFFFF', border: '1px solid rgba(14,15,12,.12)' },
    warm:     { background: '#F4F1E8', border: '1px solid rgba(14,15,12,.12)' },
    sunken:   { background: '#ECE7D9', border: 0 },
    inverse:  { background: '#0E0F0C', color: '#F4F1E8', border: 0 },
    outline:  { background: '#FFFFFF', border: '1px solid #0E0F0C' },
  };
  const v = variants[variant] || variants.default;
  return (
    <div style={{ borderRadius: 12, padding: 20, ...v, ...style }} {...rest}>
      {children}
    </div>
  );
};

const Eyebrow = ({ children, style }) => (
  <div style={{
    fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.16em', color: '#6B6759',
    ...style,
  }}>{children}</div>
);

Object.assign(window, { Badge, Tag, Card, Eyebrow });
