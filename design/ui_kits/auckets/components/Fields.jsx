// =============================================================
// AUCKETS UI Kit — Fields & Stepper
// =============================================================

const Field = ({ label, hint, children, style }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
    {label && <label style={{
      fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
      color: '#6B6759', letterSpacing: 0,
    }}>{label}</label>}
    {children}
    {hint && <div style={{
      fontFamily: 'var(--font-sans)', fontSize: 12, color: '#9C9789',
    }}>{hint}</div>}
  </div>
);

const TextInput = ({ value, onChange, placeholder, prefix, suffix, mono, type = 'text', style }) => {
  const [focused, setFocused] = React.useState(false);
  const borderColor = focused ? '#1F4A2E' : 'rgba(14,15,12,.22)';
  const ring = focused ? '0 0 0 3px rgba(31,74,46,.15)' : 'none';
  const fontFamily = mono ? 'var(--font-mono)' : 'var(--font-sans)';

  if (prefix || suffix) {
    return (
      <div style={{
        display: 'flex', alignItems: 'stretch',
        border: `1px solid ${borderColor}`, borderRadius: 8, background: '#FFFFFF',
        boxShadow: ring, transition: 'all 120ms cubic-bezier(.2,.7,.2,1)', ...style,
      }}>
        {prefix && <span style={{
          padding: '10px 4px 10px 12px', color: '#6B6759',
          fontFamily: 'var(--font-mono)', fontSize: 14,
        }}>{prefix}</span>}
        <input
          type={type} value={value} placeholder={placeholder}
          onChange={(e) => onChange && onChange(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{
            flex: 1, border: 0, outline: 'none', background: 'transparent',
            padding: prefix ? '10px 12px 10px 0' : '10px 12px',
            fontFamily, fontSize: 14, color: '#0E0F0C',
            fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
          }}
        />
        {suffix && <span style={{
          padding: '10px 12px 10px 4px', color: '#6B6759',
          fontFamily: 'var(--font-mono)', fontSize: 14,
        }}>{suffix}</span>}
      </div>
    );
  }

  return (
    <input
      type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange && onChange(e.target.value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        fontFamily, fontSize: 14, color: '#0E0F0C',
        background: '#FFFFFF', border: `1px solid ${borderColor}`,
        borderRadius: 8, padding: '10px 12px', outline: 'none',
        boxShadow: ring, transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
        fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
        ...style,
      }}
    />
  );
};

const Stepper = ({ value, onChange, min = 1, max = 8 }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center',
    border: '1px solid rgba(14,15,12,.22)', borderRadius: 999,
    background: '#FFFFFF', overflow: 'hidden', alignSelf: 'flex-start',
  }}>
    <button onClick={() => onChange(Math.max(min, value - 1))}
      style={{ background: 'transparent', border: 0, width: 36, height: 36, cursor: 'pointer', color: '#0E0F0C' }}>
      <Icon name="minus" size={14} />
    </button>
    <span style={{
      fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
      padding: '0 16px', fontSize: 14, minWidth: 28, textAlign: 'center',
    }}>{value}</span>
    <button onClick={() => onChange(Math.min(max, value + 1))}
      style={{ background: 'transparent', border: 0, width: 36, height: 36, cursor: 'pointer', color: '#0E0F0C' }}>
      <Icon name="plus" size={14} />
    </button>
  </div>
);

const RadioGroup = ({ value, onChange, options }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {options.map(opt => (
      <label key={opt.value} style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px',
        border: `1px solid ${value === opt.value ? '#0E0F0C' : 'rgba(14,15,12,.12)'}`,
        background: value === opt.value ? '#F7F6F2' : '#FFFFFF',
        borderRadius: 8, cursor: 'pointer', transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
      }}>
        <input type="radio" checked={value === opt.value}
               onChange={() => onChange(opt.value)}
               style={{ marginTop: 3, accentColor: '#1F4A2E' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: '#0E0F0C' }}>
            {opt.label}
          </span>
          {opt.hint && <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6759',
          }}>{opt.hint}</span>}
        </div>
      </label>
    ))}
  </div>
);

Object.assign(window, { Field, TextInput, Stepper, RadioGroup });
