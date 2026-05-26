// =============================================================
// AUCKETS UI Kit — Artist · Create Show
// Minimal form: pick venue, date, offer window, tier floors.
// =============================================================

const ShowCreate = ({ onBack, onCreate }) => {
  const [venue, setVenue] = React.useState('Lincoln Theatre');
  const [date, setDate]   = React.useState('2025-08-23');
  const [time, setTime]   = React.useState('20:00');
  const [windowDays, setWindowDays] = React.useState(14);
  const [floors, setFloors] = React.useState({ premium: '40', mid: '18', rear: '10' });
  const [bleacher, setBleacher] = React.useState({ enabled: true, capacity: 40, price: '15' });

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 32px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginBottom: 16,
        }}><Icon name="arrow-left" size={14} /> Back</button>

        <Eyebrow style={{ marginBottom: 10 }}>New show</Eyebrow>
        <h1 style={{ fontSize: 40, marginBottom: 28 }}>Set the room.</h1>

        <Card style={{ padding: 24, marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 14 }}>1. Venue &amp; date</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Venue" hint="Pick a venue from your library or build a new manifest (Admin).">
              <TextInput value={venue} onChange={setVenue} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Date"><TextInput value={date} onChange={setDate} mono /></Field>
              <Field label="Door time"><TextInput value={time} onChange={setTime} mono /></Field>
            </div>
          </div>
        </Card>

        <Card style={{ padding: 24, marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 14 }}>2. Offer window</Eyebrow>
          <Field label="Window length" hint="Default 14 days. Binding allocation runs 24h before doors.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Stepper value={windowDays} onChange={setWindowDays} min={1} max={60} />
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>days</span>
            </div>
          </Field>
        </Card>

        <Card style={{ padding: 24, marginBottom: 24 }}>
          <Eyebrow style={{ marginBottom: 14 }}>3. Floor prices by tier</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <Field label="Premium" hint="4 rows · 80 seats">
              <TextInput value={floors.premium} onChange={v => setFloors({...floors, premium: v})} prefix="$" mono />
            </Field>
            <Field label="Mid" hint="7 rows · 280 seats">
              <TextInput value={floors.mid} onChange={v => setFloors({...floors, mid: v})} prefix="$" mono />
            </Field>
            <Field label="Rear" hint="3 rows · 264 seats">
              <TextInput value={floors.rear} onChange={v => setFloors({...floors, rear: v})} prefix="$" mono />
            </Field>
          </div>
          <div style={{
            marginTop: 16, padding: 12, background: '#F4F1E8', borderRadius: 8,
            fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B', lineHeight: 1.55,
          }}>
            <strong style={{ color: '#0E0F0C' }}>How floors work.</strong> An offer below a tier's
            floor won't be considered for that tier. With <em>this_or_worse</em> waterfalling, the
            offer drops to the next tier where it clears the floor.
          </div>
        </Card>

        <Card style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <Eyebrow style={{ marginBottom: 4 }}>4. Bleacher Seats</Eyebrow>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>
                A reserved low-price tier outside the auction. Allocated by lottery.
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={bleacher.enabled}
                onChange={(e) => setBleacher({ ...bleacher, enabled: e.target.checked })}
                style={{ accentColor: '#1F4A2E' }} />
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>Enable</span>
            </label>
          </div>
          {bleacher.enabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Bleacher capacity" hint="Reserved from total venue capacity">
                <TextInput value={String(bleacher.capacity)}
                  onChange={v => setBleacher({ ...bleacher, capacity: parseInt(v) || 0 })} mono />
              </Field>
              <Field label="Bleacher price" hint="Flat, per ticket">
                <TextInput value={bleacher.price}
                  onChange={v => setBleacher({ ...bleacher, price: v })} prefix="$" mono />
              </Field>
            </div>
          )}
          <div style={{
            marginTop: 14, padding: 12, background: '#F4F1E8', borderRadius: 8,
            fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B', lineHeight: 1.55,
          }}>
            <strong style={{ color: '#0E0F0C' }}>Why Bleacher.</strong> The market mechanism is regressive — fans with more
            money get better seats. Bleacher carves out a fixed proportion that's affordable to anyone, allocated by
            lottery rather than offer rank.
          </div>
        </Card>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" onClick={onBack}>Save draft</Button>
          <Button variant="brand" size="lg" onClick={onCreate}>Publish show</Button>
        </div>
      </div>
    </main>
  );
};

Object.assign(window, { ShowCreate });
