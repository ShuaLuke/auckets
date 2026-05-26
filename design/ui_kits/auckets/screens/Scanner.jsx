// =============================================================
// AUCKETS UI Kit — Venue Door Scanner
// A separate surface for venue staff. Camera-style fullscreen
// scanner, list of recent scans, attendance counter.
// =============================================================

const Scanner = ({ onBack }) => {
  const [scans, setScans] = React.useState([
    { id: 1, name: 'M. Hernandez',  seats: 'Row F · 13-14',  status: 'ok',     time: '7:42pm' },
    { id: 2, name: 'J. Patel',       seats: 'Row AA · 7-10',  status: 'ok',     time: '7:41pm' },
    { id: 3, name: 'unknown token',  seats: '—',              status: 'invalid', time: '7:40pm' },
    { id: 4, name: 'A. Cope',        seats: 'Row B · 5-6',    status: 'ok',     time: '7:40pm' },
    { id: 5, name: 'B. Lin',         seats: 'Row J · 21-23',  status: 'ok',     time: '7:39pm' },
  ]);
  const [last, setLast] = React.useState({ name: 'A. Cope', seats: 'Row B · 5-6', status: 'ok' });

  // Synthetic scan pulse
  React.useEffect(() => {
    const id = setInterval(() => {
      const fake = [
        { name: 'S. Okafor',     seats: 'Row H · 9-12',  status: 'ok' },
        { name: 'D. Greenwood',  seats: 'Row AA · 1-2',  status: 'ok' },
        { name: 'replay (expired)', seats: '—',           status: 'invalid' },
        { name: 'K. Bayer',      seats: 'Row M · 17-18', status: 'ok' },
      ];
      const pick = fake[Math.floor(Math.random() * fake.length)];
      setLast(pick);
      setScans(s => [{ id: Date.now(), ...pick, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }, ...s].slice(0, 8));
    }, 4500);
    return () => clearInterval(id);
  }, []);

  const okCount = scans.filter(s => s.status === 'ok').length;

  return (
    <main style={{ background: '#0E0F0C', minHeight: 'calc(100vh - 57px)', color: '#F4F1E8' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 28px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#9C9789', marginBottom: 18,
        }}><Icon name="arrow-left" size={14} /> Exit scanner</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
          <div>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.16em', color: '#C99A4B',
            }}>Door scanner · Lincoln Theatre</span>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28,
              letterSpacing: '-0.025em', color: '#F4F1E8', marginTop: 6,
            }}>Citizen Cope · Sat May 25</h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, color: '#6A8F6F', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              412
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#9C9789' }}>
              of 487 attended · 84%
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
          {/* Camera viewport */}
          <div style={{
            background: '#000', borderRadius: 16, overflow: 'hidden',
            aspectRatio: '4 / 3', position: 'relative',
            border: last.status === 'ok' ? '3px solid #6A8F6F' : last.status === 'invalid' ? '3px solid #A93C2A' : '3px solid #1C1B17',
            transition: 'border-color 200ms cubic-bezier(.2,.7,.2,1)',
          }}>
            {/* Fake camera feed (warm noise gradient) */}
            <div style={{
              position: 'absolute', inset: 0,
              background: `
                radial-gradient(circle at 30% 40%, rgba(180,140,80,.15), transparent 50%),
                radial-gradient(circle at 70% 60%, rgba(80,60,40,.25), transparent 60%),
                #14110D
              `,
            }} />
            {/* Reticle */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 220, height: 220,
              border: '2px solid rgba(244,241,232,0.85)',
              borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(0,0,0,.45)',
            }}>
              {/* Corner brackets */}
              {['tl', 'tr', 'bl', 'br'].map(c => (
                <div key={c} style={{
                  position: 'absolute', width: 22, height: 22,
                  borderColor: '#C99A4B', borderStyle: 'solid',
                  borderWidth: c.includes('t') ? '3px 0 0 0' : '0 0 3px 0',
                  borderLeftWidth: c.includes('l') ? 3 : 0,
                  borderRightWidth: c.includes('r') ? 3 : 0,
                  ...(c === 'tl' && { top: -3, left: -3 }),
                  ...(c === 'tr' && { top: -3, right: -3 }),
                  ...(c === 'bl' && { bottom: -3, left: -3 }),
                  ...(c === 'br' && { bottom: -3, right: -3 }),
                }} />
              ))}
              {/* Scan line */}
              <div style={{
                position: 'absolute', left: 0, right: 0, top: '50%',
                height: 2, background: 'linear-gradient(90deg, transparent, #C99A4B, transparent)',
                animation: 'scanline 1.6s ease-in-out infinite',
              }} />
              <style>{`@keyframes scanline { 0% { top: 8%; } 50% { top: 92%; } 100% { top: 8%; } }`}</style>
            </div>

            {/* Last scan banner */}
            <div style={{
              position: 'absolute', bottom: 16, left: 16, right: 16,
              background: last.status === 'ok' ? 'rgba(31,74,46,.95)' : 'rgba(169,60,42,.95)',
              padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12,
              color: '#F4F1E8',
            }}>
              <Icon name={last.status === 'ok' ? 'check-circle' : 'x-circle'} size={22} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {last.status === 'ok' ? last.name : 'INVALID — ' + last.name}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.85 }}>
                  {last.seats}
                </div>
              </div>
            </div>
          </div>

          {/* Recent scans */}
          <div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.16em', color: '#9C9789',
              marginBottom: 12,
            }}>Recent scans</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scans.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: '#1C1B17', padding: '10px 12px', borderRadius: 8,
                  borderLeft: `3px solid ${s.status === 'ok' ? '#6A8F6F' : '#A93C2A'}`,
                }}>
                  <Icon name={s.status === 'ok' ? 'check' : 'x'} size={14} color={s.status === 'ok' ? '#6A8F6F' : '#A93C2A'} />
                  <div style={{ flex: 1, fontFamily: 'var(--font-sans)', fontSize: 13, color: '#F4F1E8' }}>
                    {s.name}
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9C9789' }}>{s.seats}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9C9789' }}>{s.time}</span>
                </div>
              ))}
            </div>

            <button style={{
              marginTop: 14, width: '100%', background: '#F4F1E8', color: '#0E0F0C',
              border: 0, borderRadius: 999, padding: '11px 18px', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Icon name="search" size={14} /> Look up by name + ID
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};

Object.assign(window, { Scanner });
