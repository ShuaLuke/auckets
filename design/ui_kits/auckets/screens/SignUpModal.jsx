// =============================================================
// AUCKETS UI Kit — Sign Up modal
// Stand-in for Clerk's modal. Simple, single-screen.
// =============================================================

const SignUpModal = ({ onClose, onSubmit, mode = 'signup' }) => {
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [pw, setPw] = React.useState('');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(14,15,12,.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 440, maxWidth: '100%', background: '#FFFFFF',
        borderRadius: 16, padding: 32,
        boxShadow: '0 24px 48px rgba(14,15,12,.20), 0 0 0 1px rgba(14,15,12,.12)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20,
              letterSpacing: '-0.03em', textTransform: 'uppercase',
            }}>AUCKETS</div>
            <h2 style={{ marginTop: 14, fontSize: 24 }}>
              {mode === 'signup' ? 'Create an account' : 'Sign in'}
            </h2>
            <p style={{ fontSize: 13, color: '#46443B', marginTop: 6 }}>
              {mode === 'signup'
                ? 'No fees, no countdown timers. Just an email.'
                : 'Welcome back.'}
            </p>
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Email">
            <TextInput value={email} onChange={setEmail} placeholder="you@example.com" />
          </Field>
          {mode === 'signup' && (
            <Field label="Phone" hint="For SMS notifications — outbid alerts, allocation timing, your QR ticket.">
              <TextInput value={phone} onChange={setPhone} placeholder="(555) 555-0100" />
            </Field>
          )}
          <Field label="Password">
            <TextInput type="password" value={pw} onChange={setPw} placeholder="••••••••" />
          </Field>
          <Button variant="brand" size="lg" style={{ justifyContent: 'center' }}
                  onClick={() => onSubmit(email || 'cope@auckets.com')}>
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </Button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#9C9789', fontSize: 12, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(14,15,12,.12)' }} />
            <span>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(14,15,12,.12)' }} />
          </div>

          <Button variant="secondary" size="lg" icon="mail" style={{ justifyContent: 'center' }}
                  onClick={() => onSubmit('you@google.com')}>
            Continue with Google
          </Button>
          <Button variant="secondary" size="lg" icon="apple" style={{ justifyContent: 'center' }}
                  onClick={() => onSubmit('you@icloud.com')}>
            Continue with Apple
          </Button>
        </div>

        <div style={{
          marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(14,15,12,.06)',
          fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6759', textAlign: 'center',
        }}>
          By continuing, you agree to AUCKETS's terms and the
          {' '}<a href="#" style={{ color: '#0E0F0C' }}>no-hidden-fees promise</a>.
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SignUpModal });
