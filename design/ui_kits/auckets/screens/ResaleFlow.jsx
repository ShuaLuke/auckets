// =============================================================
// AUCKETS UI Kit — Resale + Miracle Tickets
// Per product model § 7:
//   - Resale capped at original price; appreciation → artist
//   - Miracle Tickets gift to a named fan or the waitlist
// =============================================================

const ResaleFlow = ({ show, offer, onBack, onConfirm }) => {
  const [mode, setMode] = React.useState('resale');  // resale | miracle
  const [recipient, setRecipient] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);

  const paid = (parseFloat(offer?.price || 42) * (offer?.size || 4)).toFixed(2);
  const currentClearing = '$56.00';   // synthetic: current top-of-pool offer
  const artistShare = (parseFloat(currentClearing) * (offer?.size || 4) - parseFloat(paid)).toFixed(2);

  if (confirmed) return <ResaleConfirmation mode={mode} show={show} onBack={onBack} />;

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 32px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginBottom: 16,
        }}><Icon name="arrow-left" size={14} /> Back to ticket</button>

        <Eyebrow style={{ marginBottom: 10 }}>Can't make it?</Eyebrow>
        <h1 style={{ fontSize: 40, marginBottom: 16 }}>Two ways out.</h1>
        <p style={{ fontSize: 15, color: '#46443B', maxWidth: 540, lineHeight: 1.55, marginBottom: 28 }}>
          You're never stuck with an Auckets ticket. Sell it back to the pool at what you paid,
          or gift it to someone on the waitlist. Auckets is structurally hostile to scalping —
          you can't sell for more than you paid.
        </p>

        {/* Mode picker */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <ModeCard active={mode === 'resale'} onClick={() => setMode('resale')}
            icon="refresh-cw" title="List for resale"
            sub="Ticket returns to the pool. You're refunded what you paid. Any appreciation goes to the artist." />
          <ModeCard active={mode === 'miracle'} onClick={() => setMode('miracle')}
            icon="gift" title="Gift it · Miracle"
            sub="Pass it to a specific fan or the top of the waitlist. You're refunded what you paid. They pay nothing." />
        </div>

        {mode === 'resale' && (
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <Eyebrow style={{ marginBottom: 14 }}>How resale works</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <ResaleRow
                label="You're refunded" value={`$${paid}`}
                sub={`Your original ${offer?.size || 4}-ticket offer at $${parseFloat(offer?.price || 42).toFixed(2)}/ea`}
                accent />
              <ResaleRow
                label="Next buyer pays" value={`$${(parseFloat(currentClearing) * (offer?.size || 4)).toFixed(2)}`}
                sub={`Current top unplaced offer is ${currentClearing}/ea`} />
              <ResaleRow
                label="Goes to the artist" value={`+$${artistShare}`}
                sub="The appreciation between your offer and the new buyer's offer" muted />
              <div style={{
                background: '#F4F1E8', borderRadius: 8, padding: 14,
                fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', lineHeight: 1.55,
              }}>
                <strong style={{ color: '#0E0F0C' }}>Why this isn't scalping.</strong>
                {' '}You always get refunded exactly what you paid — no more, no less. The artist
                captures any market appreciation, not you. That's the deal that makes scalpers
                avoid us.
              </div>
            </div>
          </Card>
        )}

        {mode === 'miracle' && (
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <Eyebrow style={{ marginBottom: 14 }}>Gift it</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field label="Recipient"
                hint="Leave blank to give to the top of the waitlist. They'll get the seats free.">
                <TextInput value={recipient} onChange={setRecipient}
                  placeholder="friend@example.com or @username" />
              </Field>
              <ResaleRow label="You're refunded" value={`$${paid}`} accent
                sub="Goes back to the card you paid with" />
              <ResaleRow label="Recipient pays" value="$0.00"
                sub={recipient ? `Goes to ${recipient}` : 'Goes to the top of the waitlist'} muted />
              <div style={{
                background: '#EEF3EE', borderRadius: 8, padding: 14,
                fontFamily: 'var(--font-sans)', fontSize: 13, color: '#163823', lineHeight: 1.55,
              }}>
                Miracle Tickets are a one-way gift. There's no recovery — once accepted, the ticket
                belongs to the recipient.
              </div>
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onBack}>Cancel</Button>
          <Button variant="brand" size="lg" onClick={() => { setConfirmed(true); }}>
            {mode === 'resale' ? 'List for resale' : 'Send Miracle Ticket'}
          </Button>
        </div>
      </div>
    </main>
  );
};

const ModeCard = ({ active, icon, title, sub, onClick }) => (
  <button onClick={onClick} style={{
    textAlign: 'left', background: active ? '#FFFFFF' : '#F4F1E8',
    border: `1px solid ${active ? '#0E0F0C' : 'rgba(14,15,12,.12)'}`,
    borderRadius: 12, padding: 18, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 8,
    boxShadow: active ? '4px 4px 0 0 #0E0F0C' : 'none',
    transition: 'all 120ms cubic-bezier(.2,.7,.2,1)',
  }}>
    <Icon name={icon} size={20} color={active ? '#1F4A2E' : '#46443B'} />
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: '#0E0F0C', letterSpacing: '-0.01em' }}>{title}</div>
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B', lineHeight: 1.5 }}>{sub}</div>
  </button>
);

const ResaleRow = ({ label, value, sub, accent, muted }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B',
        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
      }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#6B6759' }}>{sub}</span>
    </div>
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 24,
      fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
      color: accent ? '#1F4A2E' : muted ? '#6B6759' : '#0E0F0C',
      fontWeight: accent ? 600 : 400,
    }}>{value}</span>
  </div>
);

const ResaleConfirmation = ({ mode, show, onBack }) => (
  <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '88px 32px', textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, background: '#EEF3EE',
        borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#1F4A2E', marginBottom: 22,
      }}>
        <Icon name={mode === 'resale' ? 'refresh-cw' : 'gift'} size={32} />
      </div>
      <h1 style={{ fontSize: 38, marginBottom: 14 }}>
        {mode === 'resale' ? 'Ticket back in the pool.' : 'Miracle on the way.'}
      </h1>
      <p style={{ fontSize: 15, color: '#46443B', lineHeight: 1.55, marginBottom: 28 }}>
        {mode === 'resale'
          ? <>Your seats for {show.venue} are back in the pool. The next-best unplaced offer just got promoted. You'll see your refund within 48 hours.</>
          : <>The recipient has 24 hours to claim the Miracle. We'll let you know when they do — your refund processes once they accept.</>
        }
      </p>
      <Button variant="primary" onClick={onBack}>Done</Button>
    </div>
  </main>
);

Object.assign(window, { ResaleFlow });
