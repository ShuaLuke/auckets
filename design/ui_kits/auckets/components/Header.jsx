// =============================================================
// AUCKETS UI Kit — Header (with role switcher)
// Matches src/app/layout.tsx: 57px, neutral-200 bottom border.
// Adds role pill for switching between fan / artist / admin demo
// views — entirely for the prototype, not in production.
// =============================================================

const Header = ({ user, role = 'fan', onRoleChange, onSignIn, onSignUp, onNav, onSignOut, current }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  // Top-nav items vary by role.
  const navByRole = {
    fan:    [{ id: 'dashboard', label: 'Shows' },         { id: 'offers', label: 'My offers' }],
    artist: [{ id: 'dashboard', label: 'My shows' },      { id: 'create', label: 'Create show' }],
    admin:  [{ id: 'venues',    label: 'Venues' },        { id: 'shows',  label: 'Shows' }],
  };
  const nav = navByRole[role] || [];

  const roleBadge = { fan: 'Fan', artist: 'Artist', admin: 'Admin', venue: 'Venue' }[role] || 'Fan';

  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid rgba(14,15,12,.12)',
      padding: '0 24px', height: 57,
      background: '#FFFFFF', position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onNav && onNav('landing'); }}
           className="quiet"
           style={{
             fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20,
             letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#0E0F0C',
             border: 0, fontVariationSettings: '"opsz" 32',
           }}>AUCKETS</a>
        {user && nav.length > 0 && (
          <nav style={{ display: 'flex', gap: 4 }}>
            {nav.map(item => (
              <a key={item.id} href="#"
                 onClick={(e) => { e.preventDefault(); onNav && onNav(item.id); }}
                 className="quiet"
                 style={{
                   fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
                   padding: '6px 10px', borderRadius: 6, border: 0,
                   color: current === item.id ? '#0E0F0C' : '#46443B',
                   background: current === item.id ? 'rgba(14,15,12,.06)' : 'transparent',
                   whiteSpace: 'nowrap',
                 }}>{item.label}</a>
            ))}
          </nav>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {!user && (
          <>
            <button onClick={onSignIn} style={{
              background: 'transparent', border: 0, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B',
              whiteSpace: 'nowrap', padding: '6px 10px',
            }}>Sign in</button>
            <Button variant="primary" size="sm" onClick={onSignUp}>Sign up</Button>
          </>
        )}
        {user && (
          <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6759',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                padding: '2px 7px', borderRadius: 4,
                background: role === 'artist' ? '#F6E6CC'
                         : role === 'admin'  ? '#0E0F0C'
                         : '#EEF3EE',
                color:     role === 'artist' ? '#8F6A2A'
                         : role === 'admin'  ? '#F4F1E8'
                         : '#163823',
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>{roleBadge}</span>
              {user.email}
            </span>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Account"
              style={{
                width: 32, height: 32, borderRadius: 999, border: '1px solid rgba(14,15,12,.22)',
                background: '#1F4A2E', color: '#F4F1E8', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12,
              }}>
              {user.email.slice(0, 2).toUpperCase()}
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 44, minWidth: 220,
                background: '#FFFFFF', borderRadius: 12,
                boxShadow: '0 16px 32px rgba(14,15,12,.1), 0 0 0 1px rgba(14,15,12,.12)',
                padding: 8, zIndex: 20,
              }}>
                <div style={{
                  padding: '8px 10px 6px',
                  fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759',
                  textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 600,
                }}>Switch view (demo)</div>
                {[
                  { id: 'fan',    label: 'Fan',         sub: 'Submit offers' },
                  { id: 'artist', label: 'Artist',      sub: 'Run shows' },
                  { id: 'admin',  label: 'Admin',       sub: 'Build venues' },
                  { id: 'venue',  label: 'Venue staff', sub: 'Door scanner' },
                ].map(r => (
                  <button key={r.id}
                    onClick={() => { onRoleChange(r.id); setMenuOpen(false); }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 10px',
                      borderRadius: 6, border: 0, cursor: 'pointer',
                      background: role === r.id ? 'rgba(14,15,12,.06)' : 'transparent',
                      display: 'flex', flexDirection: 'column', gap: 1,
                      fontFamily: 'var(--font-sans)',
                    }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#0E0F0C' }}>
                      {r.label}{role === r.id && <span style={{ marginLeft: 8, color: '#1F4A2E', fontSize: 11 }}>✓ active</span>}
                    </span>
                    <span style={{ fontSize: 12, color: '#6B6759' }}>{r.sub}</span>
                  </button>
                ))}
                <div style={{ borderTop: '1px solid rgba(14,15,12,.06)', margin: '8px 0' }} />
                <button onClick={() => { setMenuOpen(false); onSignOut(); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 10px',
                    borderRadius: 6, border: 0, cursor: 'pointer', background: 'transparent',
                    fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B',
                  }}>Sign out</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

Object.assign(window, { Header });
