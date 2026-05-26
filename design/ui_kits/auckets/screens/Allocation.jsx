// =============================================================
// AUCKETS UI Kit — Allocation result
// Confirmation after offer submitted; mimics post-allocation page.
// =============================================================

const Allocation = ({ show, offer, onBack, onSeeAll, onSimulateBinding }) => {
  const preview = offer?.preview || { row: 'AA', seats: [7,9,11,13], tierName: 'Premium' };
  const total = (parseFloat(offer?.price || 42) * (offer?.size || 4)).toFixed(2);

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 32px' }}>

        <Eyebrow style={{ marginBottom: 14 }}>Offer submitted</Eyebrow>
        <h1 style={{ fontSize: 44, marginBottom: 16 }}>
          You're in the room.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#2C2B25', marginBottom: 32, maxWidth: 540 }}>
          Your offer was added to the pool. We've authorized your card but haven't
          charged it. Binding allocation runs <strong>23h 14m</strong> from now —
          we'll email you the moment it does.
        </p>

        {/* Ticket-stub receipt */}
        <div style={{
          position: 'relative', background: '#FFFFFF', border: '1px solid #0E0F0C',
          borderRadius: 12, padding: 28, marginBottom: 28,
          boxShadow: '6px 6px 0 0 #0E0F0C',
        }}>
          <div style={{ position: 'absolute', left: -8, top: '50%', width: 16, height: 16, borderRadius: 999, background: '#F4F1E8', border: '1px solid #0E0F0C' }} />
          <div style={{ position: 'absolute', right: -8, top: '50%', width: 16, height: 16, borderRadius: 999, background: '#F4F1E8', border: '1px solid #0E0F0C' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <Eyebrow style={{ marginBottom: 8 }}>{show.artist}</Eyebrow>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
                {show.venue}
              </div>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#46443B', marginTop: 4 }}>
                {show.dateLong} · {show.city}
              </div>
            </div>
            <Badge tone="preview">Preview</Badge>
          </div>

          <div style={{ borderTop: '1px dashed #0E0F0C', margin: '24px 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Stat label="Price" value={`$${parseFloat(offer?.price || 42).toFixed(2)}`} sub="per ticket" />
            <Stat label="Group" value={`${offer?.size || 4}`} sub="tickets" />
            <Stat label="Tier" value={preview.tierName} sub={`Row ${preview.row}`} />
            <Stat label="Total" value={`$${total}`} sub="if placed" />
          </div>

          <div style={{ borderTop: '1px dashed #0E0F0C', margin: '24px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>
              offer_8f3a · rank_key {Math.round(parseFloat(offer?.price || 42) * 100) * 1000 + (offer?.size || 4)}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#1F4A2E' }}>
              Provisional: Row {preview.row} · seats {preview.seats[0]}–{preview.seats[preview.seats.length - 1]}
            </span>
          </div>
        </div>

        {/* What happens next */}
        <Card variant="warm" style={{ padding: 24, marginBottom: 24 }}>
          <Eyebrow style={{ marginBottom: 12 }}>What happens next</Eyebrow>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['now',    'Your placement updates as new offers come in. Watch it move.'],
              ['23h',    'Binding allocation runs. The GAE places ranked groups across the venue.'],
              ['+5min',  'You\'ll get an email with your final seats — or a refund if you weren\'t placed.'],
              ['show',   'Bring an ID. Doors at 7. Cope on at 8.'],
            ].map(([t, d], i) => (
              <li key={i} style={{ display: 'flex', gap: 14 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: '#1F4A2E',
                  background: '#EEF3EE', padding: '3px 8px', borderRadius: 4,
                  alignSelf: 'flex-start', minWidth: 52, textAlign: 'center',
                }}>{t}</span>
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#2C2B25', lineHeight: 1.5 }}>{d}</span>
              </li>
            ))}
          </ol>
        </Card>

        <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
          <Button variant="primary" onClick={onSeeAll}>Back to my shows</Button>
          <Button variant="ghost" onClick={onBack}>Revise this offer</Button>
        </div>

        {/* Demo-only: simulate binding outcome */}
        {onSimulateBinding && (
          <div style={{
            padding: 14, borderRadius: 8, background: '#ECE7D9',
            border: '1px dashed rgba(14,15,12,.22)',
            fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B',
          }}>
            <strong style={{ color: '#0E0F0C' }}>Demo · skip 23h.</strong> See the post-binding outcome:
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button variant="secondary" size="sm" onClick={() => onSimulateBinding('placed')}>
                Simulate "placed"
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onSimulateBinding('not-placed')}>
                Simulate "not placed"
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

Object.assign(window, { Allocation });
