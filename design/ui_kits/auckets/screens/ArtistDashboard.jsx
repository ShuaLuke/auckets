// =============================================================
// AUCKETS UI Kit — Artist Dashboard
// "My shows" — list of shows the artist owns, with offer-pool
// summaries and quick links to allocate / edit.
// =============================================================

const ARTIST_SHOWS = [
  {
    id: 'lincoln-may25', venue: 'Lincoln Theatre', city: 'Washington, DC',
    dateLong: 'Sat · May 25 · 8pm', dateShort: 'May 25',
    status: 'open', statusLabel: 'Offers open',
    offers: 142, capacity: 624, provisionalFilled: 487,
    medianPrice: '$28.00', topPrice: '$120.00', payout: '$13,640',
    closes: '23h until binding',
  },
  {
    id: 'paramount-jun14', venue: 'Paramount Theatre', city: 'Austin, TX',
    dateLong: 'Sat · Jun 14 · 9pm', dateShort: 'Jun 14',
    status: 'open', statusLabel: 'Offers open',
    offers: 38, capacity: 1180, provisionalFilled: 142,
    medianPrice: '$22.00', topPrice: '$85.00', payout: '$3,124',
    closes: '12d until binding',
  },
  {
    id: 'cope-place-jul02', venue: "Cope's place", city: 'Brooklyn, NY',
    dateLong: 'Wed · Jul 2 · 7:30pm', dateShort: 'Jul 2',
    status: 'upcoming', statusLabel: 'Offers open Jun 18',
    offers: 0, capacity: 50, provisionalFilled: 0,
    medianPrice: '—', topPrice: '—', payout: '$0',
    closes: '23d',
  },
];

const ArtistDashboard = ({ user, onOpenShow, onCreate }) => {
  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Artist</Eyebrow>
            <h1 style={{ fontSize: 36 }}>My shows</h1>
            <p style={{ fontSize: 14, color: '#46443B', marginTop: 4 }}>
              Three shows · 180 offers in pool across all
            </p>
          </div>
          <Button variant="brand" icon="plus" onClick={onCreate}>New show</Button>
        </div>

        {/* Snapshot stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <SnapshotStat label="Offers in pool"     value="180"      sub="across 2 open shows" />
          <SnapshotStat label="Provisional payout" value="$16,764"  sub="if allocation ran now" />
          <SnapshotStat label="Median offer"       value="$26.00"   sub="up $2 vs last show" />
          <SnapshotStat label="Capacity filled"    value="78%"      sub="Lincoln, provisional" tone="brand" />
        </div>

        {/* Show rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ARTIST_SHOWS.map(s => (
            <ArtistShowRow key={s.id} show={s} onOpen={() => onOpenShow(s)} />
          ))}
        </div>
      </div>
    </main>
  );
};

const SnapshotStat = ({ label, value, sub, tone = 'default' }) => (
  <div style={{
    background: tone === 'brand' ? '#0E0F0C' : '#FFFFFF',
    color: tone === 'brand' ? '#F4F1E8' : '#0E0F0C',
    border: '1px solid rgba(14,15,12,.12)',
    borderRadius: 12, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <span style={{
      fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.16em',
      color: tone === 'brand' ? '#9C9789' : '#6B6759',
    }}>{label}</span>
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 26, fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-0.01em', color: tone === 'brand' ? '#F4F1E8' : '#0E0F0C',
    }}>{value}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12,
                   color: tone === 'brand' ? '#C8C4B7' : '#46443B' }}>{sub}</span>
  </div>
);

const ArtistShowRow = ({ show, onOpen }) => {
  const [hover, setHover] = React.useState(false);
  const pct = Math.round(show.provisionalFilled / show.capacity * 100);
  return (
    <button onClick={onOpen}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left', background: '#FFFFFF',
        border: '1px solid rgba(14,15,12,.12)', borderRadius: 12,
        padding: '18px 20px', cursor: 'pointer', display: 'flex',
        alignItems: 'center', gap: 20,
        boxShadow: hover ? '0 4px 12px rgba(14,15,12,.06)' : 'none',
        transition: 'box-shadow 120ms cubic-bezier(.2,.7,.2,1)',
      }}>
      <div style={{
        width: 64, padding: '10px 0', textAlign: 'center',
        background: '#F4F1E8', borderRadius: 8, flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>
          {show.dateShort.split(' ')[0].toUpperCase()}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, lineHeight: 1, marginTop: 2 }}>
          {show.dateShort.split(' ')[1]}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h3 style={{ fontSize: 18 }}>{show.venue}</h3>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6759' }}>
            {show.city} · {show.dateLong}
          </span>
        </div>
        {/* Capacity bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 6, background: '#F4F1E8', borderRadius: 3, overflow: 'hidden', maxWidth: 320 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#1F4A2E' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>
            {show.provisionalFilled} / {show.capacity} · {pct}%
          </span>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 24,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B',
      }}>
        <Stat2 label="Offers"  value={show.offers} />
        <Stat2 label="Median"  value={show.medianPrice} />
        <Stat2 label="Payout"  value={show.payout} accent />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Badge tone={show.status}>{show.statusLabel}</Badge>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6B6759' }}>{show.closes}</span>
      </div>
      <Icon name="chevron-right" size={18} color="#9C9789" />
    </button>
  );
};

const Stat2 = ({ label, value, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: '#6B6759', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: accent ? '#1F4A2E' : '#0E0F0C', fontWeight: accent ? 600 : 400 }}>{value}</span>
  </div>
);

Object.assign(window, { ArtistDashboard, ARTIST_SHOWS });
