// =============================================================
// AUCKETS UI Kit — Final (binding) Allocation Result
// Post-binding states for the fan: PLACED with final seats, or
// NOT PLACED with refund confirmation. Replaces the preview
// receipt once the GAE has actually run.
// =============================================================

const AllocationFinal = ({ show, offer, outcome = 'placed', onBack, onSeeAll }) => {
  const isPlaced = outcome === 'placed';
  const preview = offer?.preview || { row: 'AA', seats: [9, 11, 13, 15], tierName: 'Premium' };
  const total = (parseFloat(offer?.price || 42) * (offer?.size || 4)).toFixed(2);

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '64px 32px' }}>

        <Eyebrow style={{ marginBottom: 14 }}>
          Allocation complete · {new Date().toLocaleDateString()}
        </Eyebrow>
        <h1 style={{ fontSize: 56, lineHeight: 1.0, letterSpacing: '-0.035em', marginBottom: 16 }}>
          {isPlaced ? "You're in." : "You're not placed."}
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#2C2B25', marginBottom: 32, maxWidth: 540 }}>
          {isPlaced
            ? <>Allocation ran 2 minutes ago. Your group has <strong>{offer?.size || 4} seats</strong> in {preview.tierName}. We've charged <span style={{ fontFamily: 'var(--font-mono)' }}>${total}</span> to your card.</>
            : <>Your offer wasn't ranked high enough to clear the venue. Your authorization has been released — <strong>no charge</strong>. The full pool placed 487 of 624 seats; the median placed offer was $32.</>
          }
        </p>

        {/* Outcome ticket */}
        {isPlaced ? (
          <div style={{
            position: 'relative', background: '#FFFFFF', border: '1px solid #0E0F0C',
            borderRadius: 12, padding: 28, marginBottom: 28,
            boxShadow: '6px 6px 0 0 #1F4A2E',
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
              <Badge tone="placed">Placed · binding</Badge>
            </div>

            <div style={{ borderTop: '1px dashed #0E0F0C', margin: '22px 0' }} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              <SeatBlock label="Section"  value={preview.tierName} sub={`Row ${preview.row}`} />
              <SeatBlock label="Seats"    value={preview.seats.join(' · ')} sub={`${offer?.size || 4} together`} />
              <SeatBlock label="Price"    value={`$${parseFloat(offer?.price || 42).toFixed(2)}`} sub="per ticket" />
              <SeatBlock label="Charged"  value={`$${total}`} sub="to •••• 4242" accent />
            </div>

            <div style={{ borderTop: '1px dashed #0E0F0C', margin: '22px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>
                offer_8f3a · placement_b9ed · pi_3MtwBwLkdIwHu7ix28a3
              </span>
              <Badge tone="placed" dot={false}>QR ready</Badge>
            </div>
          </div>
        ) : (
          <div style={{
            background: '#FFFFFF', border: '1px solid rgba(14,15,12,.12)',
            borderRadius: 12, padding: 28, marginBottom: 28,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
              <div>
                <Eyebrow style={{ marginBottom: 8 }}>{show.artist}</Eyebrow>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
                  {show.venue}
                </div>
              </div>
              <Badge tone="unplaced">Unplaced</Badge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              <SeatBlock label="Your offer"   value={`$${parseFloat(offer?.price || 22).toFixed(2)}`} sub={`× ${offer?.size || 4} tickets`} />
              <SeatBlock label="Median placed" value="$32.00"  sub="across all tiers" />
              <SeatBlock label="Released"     value="$0.00"    sub="to •••• 4242" accent />
            </div>
            <div style={{
              marginTop: 18, padding: 12, background: '#F2D9D3', borderRadius: 8,
              fontFamily: 'var(--font-sans)', fontSize: 13, color: '#722417', lineHeight: 1.5,
            }}>
              <strong>Reason:</strong> no_compatible_tier — Premium tier closed at $36 and you opted for premium-only.
              Consider opening to "this or worse" next time so we can waterfall you down.
            </div>
          </div>
        )}

        {isPlaced && (
          <Card variant="warm" style={{ padding: 22, marginBottom: 24 }}>
            <Eyebrow style={{ marginBottom: 12 }}>What's next</Eyebrow>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['email',  'Your seats just hit your inbox with a confirmation receipt.'],
                ['ticket', 'A QR ticket appears here 48 hours before doors. Same on the app.'],
                ['door',   'Bring an ID matching the name on the offer. Doors at 7. Cope on at 8.'],
              ].map(([icon, txt], i) => (
                <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Icon name={{ email: 'mail', ticket: 'qr-code', door: 'door-open' }[icon]} size={16} color="#1F4A2E" />
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#1C1B17' }}>{txt}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="primary" onClick={onSeeAll}>Back to my shows</Button>
          {!isPlaced && <Button variant="ghost" onClick={onBack}>See other shows</Button>}
        </div>
      </div>
    </main>
  );
};

const SeatBlock = ({ label, value, sub, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: accent ? '#1F4A2E' : '#0E0F0C', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.005em', fontWeight: accent ? 600 : 400 }}>{value}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>{sub}</span>
  </div>
);

Object.assign(window, { AllocationFinal });
