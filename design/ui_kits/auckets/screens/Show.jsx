// =============================================================
// AUCKETS UI Kit — Show / Offer Composer
// The core flow: pick group size + price + tier, see live preview.
// =============================================================

const Show = ({ show, onBack, onSubmit }) => {
  const [size, setSize] = React.useState(4);
  const [price, setPrice] = React.useState('42');
  const [tier, setTier] = React.useState('this_or_worse');
  const [channel, setChannel] = React.useState('market');  // market | bleacher
  const [autoBid, setAutoBid] = React.useState(false);
  const [autoMax, setAutoMax] = React.useState('60');

  const rankKey = Math.round(parseFloat(price || '0') * 100) * 1000 + size;
  const preview = channel === 'bleacher'
    ? { placed: true, row: 'BL', seats: ['—'], rank: 'lottery', totalOffers: 142, tierName: 'Bleacher' }
    : computePreview(parseFloat(price || '0'), size, tier);

  // Synthetic displacement notification
  const [displaced, setDisplaced] = React.useState(false);
  React.useEffect(() => {
    if (channel === 'bleacher') return;
    const t = setTimeout(() => setDisplaced(true), 6500);
    return () => clearTimeout(t);
  }, [channel, price]);

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 32px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginBottom: 24,
        }}>
          <Icon name="arrow-left" size={14} /> Back to shows
        </button>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, gap: 24 }}>
          <div>
            <Eyebrow style={{ marginBottom: 10 }}>{show.artist} · {show.city}</Eyebrow>
            <h1 style={{ fontSize: 56, lineHeight: 1.0, letterSpacing: '-0.035em', fontVariationSettings: '"opsz" 72' }}>
              {show.venue}
            </h1>
            <div style={{ marginTop: 12, fontFamily: 'var(--font-sans)', fontSize: 15, color: '#2C2B25' }}>
              {show.dateLong}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <Badge tone="open">Offers open</Badge>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#46443B' }}>
              Binding allocation runs in 23h 14m
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'flex-start' }}>
          {/* Offer composer */}
          <Card variant="default" style={{ padding: 24, position: 'sticky', top: 80 }}>
            <Eyebrow style={{ marginBottom: 14 }}>Your offer</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Channel — market vs Bleacher */}
              <Segmented2 value={channel} onChange={setChannel} options={[
                { value: 'market',   label: 'Market', sub: 'Rank by offer' },
                { value: 'bleacher', label: 'Bleacher', sub: '$15 · lottery' },
              ]} />

              <Field label="Group size" hint={channel === 'bleacher' ? 'Up to 2 in the Bleacher lottery.' : 'Up to 8 per fan, per show.'}>
                <Stepper value={size} onChange={setSize} min={1} max={channel === 'bleacher' ? 2 : 8} />
              </Field>

              {channel === 'market' ? (
                <>
                  <Field label="Price per ticket" hint="No hidden fees. Stripe fees come from artist payout.">
                    <TextInput value={price} onChange={setPrice} prefix="$" mono />
                  </Field>

                  <Field label="Tier preference">
                    <RadioGroup
                      value={tier}
                      onChange={setTier}
                      options={[
                        { value: 'specific',      label: 'Premium only',     hint: 'Place me in premium or not at all.' },
                        { value: 'this_or_worse', label: 'Premium or below', hint: 'Waterfall me down if premium fills.' },
                        { value: 'any',           label: 'Anywhere I fit',   hint: 'I just want a seat.' },
                      ]} />
                  </Field>

                  {/* Auto-bid */}
                  <div style={{
                    background: '#F4F1E8', borderRadius: 8, padding: 14,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={autoBid} onChange={(e) => setAutoBid(e.target.checked)}
                        style={{ marginTop: 3, accentColor: '#1F4A2E' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: '#0E0F0C' }}>
                          Auto-raise if I'm displaced
                        </div>
                        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', marginTop: 2 }}>
                          Raise by $5 each time my projected seat drops, up to my cap.
                        </div>
                      </div>
                    </label>
                    {autoBid && (
                      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B', flexShrink: 0 }}>Cap</span>
                        <TextInput value={autoMax} onChange={setAutoMax} prefix="$" mono style={{ flex: 1 }} />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{
                  background: '#F6E6CC', borderRadius: 8, padding: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 13, color: '#8F6A2A', lineHeight: 1.55,
                }}>
                  <strong style={{ color: '#0E0F0C' }}>Bleacher Seats are $15 flat.</strong>
                  {' '}40 seats per show, allocated by lottery — your odds don't change with timing.
                  Lottery draws 24h before doors.
                </div>
              )}

              <div style={{
                background: '#F4F1E8', borderRadius: 8, padding: 12,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#46443B' }}>
                  <span>Total if placed</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#0E0F0C', fontWeight: 600 }}>
                    ${channel === 'bleacher' ? (15 * size).toFixed(2) : (parseFloat(price || 0) * size).toFixed(2)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#46443B' }}>
                  <span>{channel === 'bleacher' ? 'Lottery' : 'Rank key'}</span>
                  <Tag style={{ padding: '1px 6px' }}>{channel === 'bleacher' ? 'BL_4892' : (rankKey || '—')}</Tag>
                </div>
              </div>

              <Button variant="brand" size="lg" style={{ justifyContent: 'center' }}
                onClick={() => onSubmit({ size, price, tier, channel, preview })}>
                {channel === 'bleacher' ? 'Enter the lottery' : 'Submit offer'}
              </Button>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', textAlign: 'center' }}>
                {channel === 'bleacher'
                  ? 'One entry per fan. Draws 24h before doors.'
                  : "You can revise upward until 24h before doors. Never downward."}
              </div>
            </div>
          </Card>

          {/* Live preview + venue */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {displaced && channel === 'market' && (
              <DisplacementToast onRaise={() => setPrice(String(parseFloat(price) + 5))} onDismiss={() => setDisplaced(false)} />
            )}
            <PreviewBanner preview={preview} />
            <VenuePreview placedRow={preview.row} placedSeats={preview.seats} />
            <RankBoard yourRank={preview.rank} totalOffers={preview.totalOffers} />
          </div>
        </div>
      </div>
    </main>
  );
};

// --- Synthetic preview math -------------------------------------------------

function computePreview(price, size, tier) {
  if (!price || price <= 0) {
    return { placed: false, row: null, seats: [], rank: null, totalOffers: 142, tierName: '—' };
  }
  // Greater price → better row. Synthetic linear bands.
  let row, tierName;
  if (price >= 60) { row = 'A';  tierName = 'Premium'; }
  else if (price >= 40) { row = 'AA'; tierName = 'Premium'; }
  else if (price >= 25) { row = 'F';  tierName = 'Mid'; }
  else if (price >= 15) { row = 'M';  tierName = 'Mid'; }
  else { row = 'R'; tierName = 'Rear'; }

  const seats = Array.from({ length: size }, (_, i) => 7 + i * 2);
  const rank = Math.max(1, Math.round(142 - price * 1.6 + (8 - size) * 0.3));
  return { placed: true, row, seats, rank, totalOffers: 142, tierName };
}

const PreviewBanner = ({ preview }) => {
  if (!preview.placed) {
    return (
      <Card variant="warm" style={{ padding: 18, borderColor: '#A93C2A' }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#722417' }}>
          Enter a price to see your live preview.
        </span>
      </Card>
    );
  }
  return (
    <Card variant="inverse" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <Badge tone="preview" style={{ background: '#C99A4B', color: '#0E0F0C' }} dot={false}>
            Live preview
          </Badge>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: '#F4F1E8' }}>
            You'd land in <strong>{preview.tierName}</strong> · Row{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{preview.row}</span> · seats{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {preview.seats[0]}–{preview.seats[preview.seats.length - 1]}
            </span>
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9C9789' }}>
          updates in real time
        </span>
      </div>
    </Card>
  );
};

const VenuePreview = ({ placedRow, placedSeats = [] }) => {
  // Synthetic Lincoln Theatre — orchestra + balcony, simplified.
  const sections = [
    { tier: 'Premium', rows: ['A', 'AA', 'B', 'BB'] },
    { tier: 'Mid',     rows: ['F', 'G', 'H', 'J', 'K', 'L', 'M'] },
    { tier: 'Rear',    rows: ['N', 'P', 'R'] },
  ];
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <Eyebrow>Venue · Lincoln Theatre</Eyebrow>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>
          142 offers in pool · 487 / 624 seats provisionally placed
        </span>
      </div>
      <div style={{
        background: '#F4F1E8', borderRadius: 8, padding: '32px 24px 24px',
      }}>
        <div style={{
          textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.16em', color: '#6B6759', marginBottom: 18,
        }}>STAGE</div>
        <div style={{ height: 4, background: '#0E0F0C', margin: '0 64px 24px', borderRadius: 2 }} />

        {sections.map(sec => (
          <div key={sec.tier} style={{ marginBottom: 18 }}>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.16em',
              color: '#6B6759', marginBottom: 8,
            }}>{sec.tier}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sec.rows.map(r => (
                <VenueRow key={r} row={r} highlighted={r === placedRow} highlightSeats={placedSeats} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const VenueRow = ({ row, highlighted, highlightSeats = [] }) => {
  const SEATS = 14;
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{
        width: 22, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6B6759',
        textAlign: 'right',
      }}>{row}</span>
      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        {Array.from({ length: SEATS }, (_, i) => {
          const seatNum = i * 2 + 1;
          const isYours = highlighted && highlightSeats.includes(seatNum);
          const filled = !highlighted && (i + row.charCodeAt(0)) % 3 !== 0;
          return (
            <div key={i} style={{
              flex: 1, height: 14, borderRadius: 3,
              background: isYours ? '#1F4A2E'
                : filled ? '#D5E2D5'
                : '#FFFFFF',
              border: isYours ? 'none' : '1px solid rgba(14,15,12,.08)',
            }} />
          );
        })}
      </div>
    </div>
  );
};

const RankBoard = ({ yourRank, totalOffers }) => (
  <Card style={{ padding: 20 }}>
    <Eyebrow style={{ marginBottom: 12 }}>The room right now</Eyebrow>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      <Stat label="Your rank" value={yourRank ? `#${yourRank}` : '—'} sub={`of ${totalOffers} offers`} />
      <Stat label="Median offer" value="$28.00" sub="up $2 since 12h ago" />
      <Stat label="Capacity" value="78%" sub="provisionally placed" />
    </div>
  </Card>
);

const Stat = ({ label, value, sub }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: '#0E0F0C', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{value}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>{sub}</span>
  </div>
);

// --- Displacement toast ----------------------------------------------------

const DisplacementToast = ({ onRaise, onDismiss }) => (
  <div style={{
    background: '#F6E6CC', border: '1px solid #C99A4B', borderRadius: 8,
    padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
    animation: 'slideIn 220ms cubic-bezier(0.2,0.7,0.2,1)',
  }}>
    <style>{`@keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    <Icon name="trending-down" size={20} color="#8F6A2A" />
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#0E0F0C', fontWeight: 500, marginBottom: 2 }}>
        You were just displaced.
      </div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#8F6A2A' }}>
        A $48 × 4 offer landed above yours. You're now in <span style={{ fontFamily: 'var(--font-mono)' }}>Row F</span>, down from <span style={{ fontFamily: 'var(--font-mono)' }}>Row AA</span>.
      </div>
    </div>
    <Button variant="primary" size="sm" onClick={onRaise}>Raise $5</Button>
    <button onClick={onDismiss} aria-label="Dismiss" style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#46443B' }}>
      <Icon name="x" size={16} />
    </button>
  </div>
);

// --- Segmented (channel picker) -------------------------------------------

const Segmented2 = ({ value, onChange, options }) => (
  <div style={{ display: 'flex', gap: 8 }}>
    {options.map(opt => (
      <button key={opt.value} onClick={() => onChange(opt.value)} style={{
        flex: 1, padding: '10px 12px', cursor: 'pointer',
        border: `1px solid ${value === opt.value ? '#0E0F0C' : 'rgba(14,15,12,.22)'}`,
        background: value === opt.value ? '#0E0F0C' : '#FFFFFF',
        color: value === opt.value ? '#F4F1E8' : '#0E0F0C',
        borderRadius: 8, textAlign: 'left',
        fontFamily: 'var(--font-sans)', transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{opt.sub}</div>
      </button>
    ))}
  </div>
);

Object.assign(window, { Show });
