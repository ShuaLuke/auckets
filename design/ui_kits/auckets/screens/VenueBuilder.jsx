// =============================================================
// AUCKETS UI Kit — Admin · Venue Architecture Builder
// Per docs/CONTEXT.md Q23/Q24: the team builds manifests manually.
// Editable list of rows with capacity, parity, lean, tier, holds.
// =============================================================

const INITIAL_ROWS = [
  { id: 1,  name: 'A',  area: 'orchestra',     tier: 'premium', cap: 18, parity: 'EVEN', lean: 'CENTER',     rank: 1,  holds: 0 },
  { id: 2,  name: 'AA', area: 'orchestra',     tier: 'premium', cap: 20, parity: 'EVEN', lean: 'CENTER',     rank: 2,  holds: 6 },
  { id: 3,  name: 'B',  area: 'orchestra',     tier: 'premium', cap: 22, parity: 'EVEN', lean: 'CENTER',     rank: 3,  holds: 0 },
  { id: 4,  name: 'BB', area: 'orchestra',     tier: 'premium', cap: 22, parity: 'EVEN', lean: 'CENTER',     rank: 4,  holds: 4 },
  { id: 5,  name: 'F',  area: 'orchestra',     tier: 'mid',     cap: 24, parity: 'EVEN', lean: 'DUAL_AISLE', rank: 5,  holds: 4 },
  { id: 6,  name: 'G',  area: 'orchestra',     tier: 'mid',     cap: 24, parity: 'EVEN', lean: 'DUAL_AISLE', rank: 6,  holds: 0 },
  { id: 7,  name: 'H',  area: 'orchestra',     tier: 'mid',     cap: 26, parity: 'EVEN', lean: 'DUAL_AISLE', rank: 7,  holds: 0 },
  { id: 8,  name: 'J',  area: 'orchestra',     tier: 'mid',     cap: 26, parity: 'EVEN', lean: 'DUAL_AISLE', rank: 8,  holds: 0 },
  { id: 9,  name: 'M',  area: 'front_balcony', tier: 'rear',    cap: 28, parity: 'EVEN', lean: 'CENTER',     rank: 9,  holds: 2 },
];

const VenueBuilder = ({ onBack }) => {
  const [rows, setRows] = React.useState(INITIAL_ROWS);
  const [selected, setSelected] = React.useState(2);

  const update = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const addRow = () => {
    const next = Math.max(...rows.map(r => r.rank)) + 1;
    setRows([...rows, {
      id: Date.now(), name: `Row ${next}`, area: 'orchestra', tier: 'mid',
      cap: 20, parity: 'EVEN', lean: 'CENTER', rank: next, holds: 0,
    }]);
  };
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id));

  const sel = rows.find(r => r.id === selected);
  const totalCap = rows.reduce((s, r) => s + r.cap, 0);
  const totalHolds = rows.reduce((s, r) => s + r.holds, 0);

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginBottom: 16,
        }}><Icon name="arrow-left" size={14} /> Back</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, gap: 16 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Admin · Venue architecture</Eyebrow>
            <h1 style={{ fontSize: 36 }}>Lincoln Theatre</h1>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#46443B' }}>
              {rows.length} rows · {totalCap} seats · {totalHolds} venue-level holds · Washington, DC
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" icon="upload">Import JSON</Button>
            <Button variant="brand" icon="check">Publish manifest</Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          {/* Row list */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 90px 80px 60px 70px 56px',
              padding: '10px 16px', background: '#F4F1E8',
              borderBottom: '1px solid rgba(14,15,12,.06)',
              fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.16em', color: '#6B6759',
            }}>
              <span>#</span><span>Row · area</span><span>Tier</span><span>Lean</span><span>Cap</span><span>Holds</span><span></span>
            </div>
            {rows.map(r => (
              <div key={r.id} onClick={() => setSelected(r.id)} style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 90px 80px 60px 70px 56px',
                padding: '10px 16px', alignItems: 'center',
                background: selected === r.id ? '#F4F1E8' : 'transparent',
                borderBottom: '1px solid rgba(14,15,12,.06)',
                cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12,
              }}>
                <span style={{ color: '#6B6759' }}>{r.rank}</span>
                <span style={{ color: '#0E0F0C' }}>
                  <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                  <span style={{ color: '#6B6759', marginLeft: 8 }}>{r.area.replace('_', ' ')}</span>
                </span>
                <Tag tone={r.tier === 'premium' ? 'brand' : 'neutral'} style={{ alignSelf: 'flex-start' }}>{r.tier}</Tag>
                <span style={{ color: '#46443B' }}>{r.lean.toLowerCase().replace('_', ' ')}</span>
                <span style={{ color: '#0E0F0C' }}>{r.cap}</span>
                <span style={{ color: r.holds > 0 ? '#8F6A2A' : '#9C9789' }}>{r.holds || '—'}</span>
                <button onClick={(e) => { e.stopPropagation(); removeRow(r.id); }}
                  style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#9C9789' }}
                  aria-label="Remove row">
                  <Icon name="trash-2" size={14} />
                </button>
              </div>
            ))}
            <div style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button variant="ghost" icon="plus" size="sm" onClick={addRow}>Add row</Button>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>
                {totalCap} seats total
              </span>
            </div>
          </Card>

          {/* Row editor */}
          {sel && (
            <Card style={{ padding: 20, alignSelf: 'flex-start', position: 'sticky', top: 76 }}>
              <Eyebrow style={{ marginBottom: 12 }}>Row · {sel.name}</Eyebrow>
              <h3 style={{ fontSize: 18, marginBottom: 14 }}>
                Rank <span style={{ fontFamily: 'var(--font-mono)' }}>{sel.rank}</span> · {sel.area.replace('_', ' ')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Row name">
                  <TextInput value={sel.name} onChange={v => update(sel.id, { name: v })} mono />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Capacity">
                    <TextInput value={String(sel.cap)} onChange={v => update(sel.id, { cap: parseInt(v) || 0 })} mono />
                  </Field>
                  <Field label="Parity">
                    <Segmented value={sel.parity} onChange={v => update(sel.id, { parity: v })} options={[{ value: 'ODD', label: 'Odd' }, { value: 'EVEN', label: 'Even' }]} />
                  </Field>
                </div>
                <Field label="Tier" hint="Waterfalls down from premium to mid to rear.">
                  <Segmented value={sel.tier} onChange={v => update(sel.id, { tier: v })} options={[
                    { value: 'premium', label: 'Premium' },
                    { value: 'mid',     label: 'Mid' },
                    { value: 'rear',    label: 'Rear' },
                  ]} />
                </Field>
                <Field label="Lean" hint="How groups expand within the row.">
                  <Segmented value={sel.lean} onChange={v => update(sel.id, { lean: v })} options={[
                    { value: 'CENTER',     label: 'Center' },
                    { value: 'LEFT',       label: 'Left' },
                    { value: 'RIGHT',      label: 'Right' },
                    { value: 'DUAL_AISLE', label: 'Dual aisle' },
                  ]} />
                </Field>
                <Field label="Holds (venue, ADA, production)" hint="Counts toward unavailable seats.">
                  <TextInput value={String(sel.holds)} onChange={v => update(sel.id, { holds: parseInt(v) || 0 })} mono />
                </Field>
              </div>

              <div style={{
                marginTop: 16, padding: 12, background: '#0E0F0C', borderRadius: 8,
                fontFamily: 'var(--font-mono)', fontSize: 11, color: '#C8C4B7', lineHeight: 1.7,
              }}>
                <div><span style={{ color: '#6A8F6F' }}>{`{`}</span></div>
                <div>{`  `}id: <span style={{ color: '#E5BC79' }}>"row_{sel.name.toLowerCase()}_{sel.area.slice(0, 3)}"</span>,</div>
                <div>{`  `}rowRank: {sel.rank},</div>
                <div>{`  `}capacity: {sel.cap},</div>
                <div>{`  `}parity: <span style={{ color: '#E5BC79' }}>"{sel.parity}"</span>,</div>
                <div>{`  `}lean: <span style={{ color: '#E5BC79' }}>"{sel.lean}"</span>,</div>
                <div>{`  `}tier: <span style={{ color: '#E5BC79' }}>"{sel.tier}"</span>,</div>
                <div><span style={{ color: '#6A8F6F' }}>{`}`}</span></div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
};

const Segmented = ({ value, onChange, options }) => (
  <div style={{
    display: 'flex', background: '#F4F1E8',
    borderRadius: 8, padding: 3, gap: 2,
  }}>
    {options.map(opt => (
      <button key={opt.value} onClick={() => onChange(opt.value)} style={{
        flex: 1, padding: '7px 10px', border: 0, borderRadius: 6,
        cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500,
        background: value === opt.value ? '#FFFFFF' : 'transparent',
        color: value === opt.value ? '#0E0F0C' : '#46443B',
        boxShadow: value === opt.value ? '0 1px 2px rgba(14,15,12,.06)' : 'none',
      }}>{opt.label}</button>
    ))}
  </div>
);

Object.assign(window, { VenueBuilder });
