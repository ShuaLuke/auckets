// =============================================================
// AUCKETS UI Kit — Buttons
// Pill primary/brand/secondary/ghost + Marquee CTA + IconButton
// =============================================================

const ukBtnBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  fontSize: 14,
  letterSpacing: '-0.01em',
  borderRadius: 999,
  padding: '8px 18px',
  border: '1px solid transparent',
  cursor: 'pointer',
  lineHeight: 1,
  transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

const ukBtnVariants = {
  primary:   { background: '#0E0F0C', color: '#F4F1E8' },
  brand:     { background: '#1F4A2E', color: '#F4F1E8' },
  secondary: { background: '#FFFFFF', color: '#0E0F0C', borderColor: 'rgba(14,15,12,.22)' },
  ghost:     { background: 'transparent', color: '#0E0F0C' },
  inverse:   { background: '#F4F1E8', color: '#0E0F0C' },
};

const ukBtnSizes = {
  sm: { padding: '5px 12px', fontSize: 12 },
  md: { padding: '8px 18px', fontSize: 14 },
  lg: { padding: '11px 22px', fontSize: 15 },
};

const Button = ({ variant = 'primary', size = 'md', icon, iconAfter, children, style, ...rest }) => {
  const [hover, setHover] = React.useState(false);
  const v = ukBtnVariants[variant] || ukBtnVariants.primary;
  const s = ukBtnSizes[size] || ukBtnSizes.md;
  const hoverShade = {
    primary:   { background: '#2C2B25' },
    brand:     { background: '#163823' },
    secondary: { background: '#F7F6F2' },
    ghost:     { background: 'rgba(14,15,12,.06)' },
    inverse:   { background: '#ECE7D9' },
  }[variant] || {};
  return (
    <button
      style={{ ...ukBtnBase, ...v, ...s, ...(hover ? hoverShade : {}), ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={size === 'lg' ? 18 : 16} />}
    </button>
  );
};

const MarqueeButton = ({ children, icon, iconAfter, style, ...rest }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15,
        letterSpacing: '-0.01em',
        background: '#FFFFFF', color: '#0E0F0C',
        border: '1px solid #0E0F0C', borderRadius: 8,
        padding: '11px 22px', cursor: 'pointer',
        boxShadow: hover ? '2px 2px 0 0 #0E0F0C' : '4px 4px 0 0 #0E0F0C',
        transform: hover ? 'translate(2px, 2px)' : 'translate(0,0)',
        transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={18} />}
    </button>
  );
};

const IconButton = ({ icon, label, size = 32, style, ...rest }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size, height: size, padding: 0, border: 0, cursor: 'pointer',
        borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: hover ? 'rgba(14,15,12,.12)' : 'rgba(14,15,12,.06)',
        color: '#0E0F0C', transition: 'background 120ms cubic-bezier(.2,.7,.2,1)',
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={size * 0.5} />
    </button>
  );
};

Object.assign(window, { Button, MarqueeButton, IconButton });
