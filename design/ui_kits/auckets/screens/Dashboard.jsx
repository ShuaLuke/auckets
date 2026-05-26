// =============================================================
// AUCKETS UI Kit — Dashboard (fan side)
// List of upcoming shows + the fan's offers across them.
// =============================================================

const SHOWS = [
  {
    id: 'lincoln-may25',
    artist: 'Citizen Cope',
    venue: 'Lincoln Theatre',
    city: 'Washington, DC',
    dateLong: 'Sat · May 25 · 8pm',
    dateShort: 'May 25',
    status: 'placed',
    statusLabel: 'Placed · view ticket',
    closes: 'doors in 4h 12m',
    yourOffer: { price: '$42.00', size: 4, preview: 'Orchestra · Row AA · seats 7–10', placed: true, ticketReady: true },
  },
  {
    id: 'paramount-jun14',
    artist: 'Citizen Cope',
    venue: 'Paramount Theatre',
    city: 'Austin, TX',
    dateLong: 'Sat · Jun 14 · 9pm',
    dateShort: 'Jun 14',
    status: 'open',
    statusLabel: 'Offers open',
    closes: '12d until binding',
    yourOffer: null,
  },
  {
    id: 'cope-place-jul02',
    artist: 'Citizen Cope',
    venue: "Cope's place",
    city: 'Brooklyn, NY',
    dateLong: 'Wed · Jul 2 · 7:30pm',
    dateShort: 'Jul 2',
    status: 'upcoming',
    statusLabel: 'Offers open Jun 18',
    closes: '23d',
    yourOffer: null,
  },
];

const Dashboard = ({ user, onOpenShow, onOpenTicket, onSimulateCardFailure }) => {
  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 28 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Welcome back</Eyebrow>
            <h1 style={{ fontSize: 36 }}>Shows</h1>
          </div>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>
            Signed in as <span style={{ color: '#0E0F0C', fontWeight: 500 }}>{user.email}</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SHOWS.map(s => (
            <ShowRow key={s.id} show={s}
              onOpen={() => s.yourOffer?.ticketReady ? onOpenTicket(s) : onOpenShow(s)} />
          ))}
        </div>

        <div style={{
          marginTop: 40, padding: 20, borderRadius: 12, background: '#ECE7D9',
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', lineHeight: 1.55,
        }}>
          <strong style={{ color: '#0E0F0C' }}>Heads up.</strong>{' '}
          Allocation is binding 24 hours before doors. Until then, your placement is a
          non-binding preview — you can revise upward, never downward.
        </div>

        {onSimulateCardFailure && (
          <div style={{
            marginTop: 14, padding: 14, borderRadius: 8, background: '#FFFFFF',
            border: '1px dashed rgba(14,15,12,.22)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>
              <strong style={{ color: '#0E0F0C' }}>Demo:</strong> simulate card decline at allocation time.
            </span>
            <Button variant="secondary" size="sm" onClick={onSimulateCardFailure}>Trigger</Button>
          </div>
        )}
      </div>
    </main>
  );
};

const ShowRow = ({ show, onOpen }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left', background: '#FFFFFF',
        border: '1px solid rgba(14,15,12,.12)',
        borderRadius: 12, padding: '18px 20px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 20,
        boxShadow: hover ? '0 4px 12px rgba(14,15,12,.06)' : 'none',
        transition: 'box-shadow 120ms cubic-bezier(.2,.7,.2,1)',
      }}>
      {/* Date stub */}
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
            {show.artist} · {show.city}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>{show.dateLong}</div>
        {show.yourOffer && (
          <div style={{
            marginTop: 4, display: 'inline-flex', alignSelf: 'flex-start', gap: 8, alignItems: 'baseline',
            padding: '4px 10px', borderRadius: 6, background: '#EEF3EE',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#163823' }}>
              {show.yourOffer.price} × {show.yourOffer.size}
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#1F4A2E' }}>
              · {show.yourOffer.preview}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <Badge tone={show.status}>{show.statusLabel}</Badge>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>{show.closes}</span>
      </div>
      <Icon name="chevron-right" size={18} color="#9C9789" />
    </button>
  );
};

Object.assign(window, { Dashboard, SHOWS });
