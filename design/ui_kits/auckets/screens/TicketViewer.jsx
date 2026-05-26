// =============================================================
// AUCKETS UI Kit — Fan Ticket Viewer
// Rotating geo-gated QR per the product model § 6.
// - QR regenerates every 60s (TOTP-style)
// - Requires geolocation permission
// - Only validates within venue radius (configurable, ~few hundred m)
// =============================================================

const TicketViewer = ({ show, offer, onBack, onResale }) => {
  // Geo permission flow
  const [geoState, setGeoState] = React.useState('prompt');  // prompt | requesting | granted | denied | far
  const [distance, setDistance] = React.useState(null);

  // Rotating QR
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const requestGeo = () => {
    setGeoState('requesting');
    // Simulated: in production, navigator.geolocation.getCurrentPosition()
    setTimeout(() => {
      // Demo: roll the dice between granted / far
      const ok = Math.random() > 0.15;
      setGeoState(ok ? 'granted' : 'far');
      setDistance(ok ? Math.floor(Math.random() * 80 + 30) : 4_200);
    }, 900);
  };

  const seats = offer?.preview?.seats || [7, 9, 11, 13];
  const row = offer?.preview?.row || 'AA';
  const tier = offer?.preview?.tierName || 'Premium';
  const total = (parseFloat(offer?.price || 42) * (offer?.size || 4)).toFixed(2);

  // Seconds until next QR cycle (60s window)
  const secondsLeft = 60 - (tick % 60);

  return (
    <main style={{ background: '#0E0F0C', minHeight: 'calc(100vh - 57px)', color: '#F4F1E8' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#C8C4B7', marginBottom: 24,
        }}><Icon name="arrow-left" size={14} /> Back to shows</button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.16em', color: '#C99A4B',
          }}>Show ticket · {show.artist}</span>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, lineHeight: 1.05,
            letterSpacing: '-0.03em', color: '#F4F1E8', marginTop: 8,
          }}>{show.venue}</h1>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#9C9789', marginTop: 4 }}>
            {show.dateLong} · {show.city}
          </div>
        </div>

        {/* QR panel — gated on geo */}
        <div style={{
          background: '#F4F1E8', color: '#0E0F0C', borderRadius: 12, padding: 24,
          boxShadow: '0 24px 64px rgba(0,0,0,.4)',
          position: 'relative', overflow: 'hidden',
        }}>
          {geoState === 'prompt' && (
            <GeoPrompt onAllow={requestGeo} />
          )}
          {geoState === 'requesting' && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{
                width: 28, height: 28, border: '3px solid #C8C4B7',
                borderTopColor: '#1F4A2E', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', margin: '0 auto 14px',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>
                Checking location…
              </div>
            </div>
          )}
          {geoState === 'denied' && (
            <GeoBlocked title="Location required"
              body="AUCKETS tickets are geo-gated to prevent remote handoff to scalpers. Re-enable location for AUCKETS in your browser settings, then refresh."
              cta="Try again" onRetry={requestGeo} />
          )}
          {geoState === 'far' && (
            <GeoBlocked title={`You're ${distance.toLocaleString()}m from the venue`}
              body="Your ticket won't show until you're near the doors. Head over — we'll unlock it within ~500m of Lincoln Theatre."
              cta="Check again" onRetry={requestGeo} />
          )}
          {geoState === 'granted' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Badge tone="placed" dot={true}>Live ticket · {distance}m from venue</Badge>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>
                  Rotates in {secondsLeft}s
                </span>
              </div>

              {/* QR */}
              <QRPlaceholder seed={tick} />

              {/* Countdown bar */}
              <div style={{
                height: 4, background: '#E8E6DE', borderRadius: 2, overflow: 'hidden', marginTop: 16,
              }}>
                <div style={{
                  width: `${(secondsLeft / 60) * 100}%`,
                  height: '100%', background: '#1F4A2E',
                  transition: 'width 1s linear',
                }} />
              </div>

              {/* Seat block */}
              <div style={{ borderTop: '1px dashed rgba(14,15,12,.22)', margin: '22px -8px 18px' }} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <SeatStat label="Section" value={tier} />
                <SeatStat label="Row" value={row} />
                <SeatStat label="Seats" value={seats.join(' · ')} />
                <SeatStat label="Paid" value={`$${total}`} />
              </div>

              <div style={{
                marginTop: 18, padding: '10px 12px', background: '#0E0F0C', borderRadius: 6,
                fontFamily: 'var(--font-mono)', fontSize: 10, color: '#9C9789', letterSpacing: '0.02em',
              }}>
                token: <span style={{ color: '#C99A4B' }}>tok_{(tick * 7919 + 13).toString(36).padStart(8, '0').slice(0, 8)}</span>
                {' · '}exp: <span style={{ color: '#6A8F6F' }}>{secondsLeft}s</span>
              </div>
            </>
          )}
        </div>

        {/* Helpful footer */}
        <div style={{
          marginTop: 22, padding: 16, background: '#1C1B17', borderRadius: 8,
          fontFamily: 'var(--font-sans)', fontSize: 12, color: '#9C9789', lineHeight: 1.55,
        }}>
          <strong style={{ color: '#F4F1E8', display: 'block', marginBottom: 6 }}>
            <Icon name="info" size={12} style={{ marginRight: 6, verticalAlign: '-1px' }} />
            Why this rotates
          </strong>
          A screenshot of an Auckets ticket is worthless after 60 seconds. The QR is bound to your account and your phone's location; sending it to someone else won't work.
        </div>

        {/* Resale + Miracle */}
        <div style={{
          marginTop: 18, padding: 16, background: '#1C1B17', borderRadius: 8,
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#9C9789', flex: 1, alignSelf: 'center', minWidth: 140 }}>
            Can't make it?
          </span>
          <Button variant="inverse" size="sm" icon="refresh-cw" onClick={() => onResale && onResale()}>
            List for resale
          </Button>
          <Button variant="inverse" size="sm" icon="gift" onClick={() => onResale && onResale('miracle')}>
            Gift it
          </Button>
        </div>
      </div>
    </main>
  );
};

const GeoPrompt = ({ onAllow }) => (
  <div style={{ padding: '24px 8px', textAlign: 'center' }}>
    <div style={{
      width: 56, height: 56, background: '#0E0F0C',
      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto 18px', color: '#C99A4B',
    }}>
      <Icon name="map-pin" size={26} />
    </div>
    <h3 style={{ fontSize: 20, marginBottom: 8 }}>Unlock your ticket at the venue</h3>
    <p style={{ fontSize: 14, color: '#46443B', lineHeight: 1.55, marginBottom: 20, maxWidth: 320, margin: '0 auto 20px' }}>
      Auckets tickets are geo-gated. They appear when you're within ~500m of Lincoln Theatre and rotate every 60s to prevent remote handoff.
    </p>
    <Button variant="brand" size="lg" onClick={onAllow}>Allow location</Button>
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', marginTop: 12 }}>
      Auckets never stores your precise location.
    </div>
  </div>
);

const GeoBlocked = ({ title, body, cta, onRetry }) => (
  <div style={{ padding: '24px 8px', textAlign: 'center' }}>
    <div style={{
      width: 56, height: 56, background: '#F2D9D3',
      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto 18px', color: '#A93C2A',
    }}>
      <Icon name="map-pin-off" size={26} />
    </div>
    <h3 style={{ fontSize: 18, marginBottom: 8 }}>{title}</h3>
    <p style={{ fontSize: 14, color: '#46443B', lineHeight: 1.55, marginBottom: 18, maxWidth: 320, margin: '0 auto 18px' }}>
      {body}
    </p>
    <Button variant="primary" onClick={onRetry}>{cta}</Button>
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', marginTop: 12 }}>
      Trouble? Find a venue staffer with an Auckets tablet — they can look you up by name and ID.
    </div>
  </div>
);

const QRPlaceholder = ({ seed }) => {
  // Render a deterministic faux-QR based on the seed. Production would
  // use a real qrcode lib against the TOTP token.
  const SIZE = 21;
  const cells = [];
  let s = seed * 1103515245 + 12345;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Position markers in 3 corners (top-left, top-right, bottom-left)
      const inFinder = (
        (x < 7 && y < 7) ||
        (x >= SIZE - 7 && y < 7) ||
        (x < 7 && y >= SIZE - 7)
      );
      if (inFinder) {
        const isOuterRing = x === 0 || y === 0 || x === 6 || y === 6 ||
          x === SIZE - 1 || y === SIZE - 1 || x === SIZE - 7 || y === SIZE - 7;
        const isCenter =
          (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
          (x >= SIZE - 5 && x <= SIZE - 3 && y >= 2 && y <= 4) ||
          (x >= 2 && x <= 4 && y >= SIZE - 5 && y <= SIZE - 3);
        cells.push(isOuterRing || isCenter ? 1 : 0);
        continue;
      }
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      cells.push((s >> 16) & 1);
    }
  }
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 8, padding: 16,
      display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: 1,
      aspectRatio: '1 / 1', width: '100%', maxWidth: 280, margin: '0 auto',
    }}>
      {cells.map((c, i) => (
        <div key={i} style={{
          background: c ? '#0E0F0C' : '#FFFFFF',
          aspectRatio: '1 / 1',
        }} />
      ))}
    </div>
  );
};

const SeatStat = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{
      fontFamily: 'var(--font-sans)', fontSize: 10, color: '#6B6759',
      textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
    }}>{label}</span>
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 16, color: '#0E0F0C',
      fontVariantNumeric: 'tabular-nums',
    }}>{value}</span>
  </div>
);

Object.assign(window, { TicketViewer });
