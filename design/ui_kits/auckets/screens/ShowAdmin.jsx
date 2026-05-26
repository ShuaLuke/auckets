// =============================================================
// AUCKETS UI Kit — Artist Show Admin
// Live view of a single show: offer pool, distribution, controls.
// Per docs/CONTEXT.md Q30 "Artist visibility": aggregate during
// window, full visibility after allocation runs.
// =============================================================

const ShowAdmin = ({ show, onBack, onRunAllocation }) => {
  const [running, setRunning] = React.useState(false);
  const [tab, setTab] = React.useState('overview');
  const [requestOpen, setRequestOpen] = React.useState(false);

  return (
    <main style={{ background: '#F4F1E8', minHeight: 'calc(100vh - 57px)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 64px' }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginBottom: 24,
        }}>
          <Icon name="arrow-left" size={14} /> Back to my shows
        </button>

        {/* Show header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 28 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>{show.city}</Eyebrow>
            <h1 style={{ fontSize: 44, letterSpacing: '-0.03em' }}>{show.venue}</h1>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#46443B' }}>
              {show.dateLong} · {show.capacity} seats · {show.offers} offers in pool
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="secondary" icon="message-square" onClick={() => setRequestOpen(true)}>
              Request action
            </Button>
            <MarqueeButton iconAfter="zap" onClick={() => setRunning(true)}>
              Preview allocation
            </MarqueeButton>
          </div>
        </div>

        {/* Status banner */}
        <Card variant="inverse" style={{ marginBottom: 20, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <Badge tone="preview" dot={false}>Offers open</Badge>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: '#F4F1E8' }}>
                Binding allocation runs in <strong style={{ fontFamily: 'var(--font-mono)' }}>{show.closes}</strong>
              </span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9C9789' }}>
              Next preview computes every 60s · last run 12s ago
            </span>
          </div>
        </Card>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 4, borderBottom: '1px solid rgba(14,15,12,.12)',
          marginBottom: 24,
        }}>
          {[
            { id: 'overview',     label: 'Overview' },
            { id: 'distribution', label: 'Offer distribution' },
            { id: 'allocation',   label: 'Provisional placement' },
            { id: 'holds',        label: 'Holds & manifest' },
            { id: 'fans',         label: 'Fans · data' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'transparent', border: 0, cursor: 'pointer',
              padding: '10px 12px', marginBottom: -1,
              fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
              color: tab === t.id ? '#0E0F0C' : '#6B6759',
              borderBottom: `2px solid ${tab === t.id ? '#1F4A2E' : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'overview' && <Overview show={show} />}
        {tab === 'distribution' && <Distribution />}
        {tab === 'allocation' && <ProvisionalPlacement />}
        {tab === 'holds' && <Holds />}
        {tab === 'fans' && <FanData />}

      </div>

      {running && (
        <AllocationDialog onClose={() => setRunning(false)} onConfirm={() => { setRunning(false); onRunAllocation && onRunAllocation(); }} />
      )}
      {requestOpen && (
        <RequestActionDialog onClose={() => setRequestOpen(false)} />
      )}
    </main>
  );
};

// --- Overview tab ----------------------------------------------------------

const Overview = ({ show }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
    <Card style={{ padding: 20 }}>
      <Eyebrow style={{ marginBottom: 14 }}>Offer pool — aggregate</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <BigStat label="Offers"            value={show.offers}        sub="in pool" />
        <BigStat label="Provisional fill"  value={`${Math.round(show.provisionalFilled / show.capacity * 100)}%`} sub={`${show.provisionalFilled} / ${show.capacity}`} />
        <BigStat label="Median price"      value={show.medianPrice}   sub="up $2 vs 12h ago" />
        <BigStat label="Top price"         value={show.topPrice}      sub="row A premium" />
        <BigStat label="Provisional payout" value={show.payout}       sub="if allocation ran now" accent />
        <BigStat label="Unplaced"          value="14"                 sub="below tier minimums" />
      </div>
    </Card>
    <Card style={{ padding: 20 }}>
      <Eyebrow style={{ marginBottom: 14 }}>Recent activity</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {[
          ['2m ago',  'New offer · $54 × 2 · tier=premium'],
          ['7m ago',  'Revision · offer_8f3a · $38 → $42'],
          ['12m ago', 'New offer · $22 × 6 · tier=any'],
          ['18m ago', 'Preview computed · 487 placed, 14 unplaced'],
          ['41m ago', 'New offer · $35 × 3 · tier=this_or_worse'],
          ['1h ago',  'Revision · offer_b021 · $28 → $35'],
          ['2h ago',  'New offer · $120 × 4 · tier=specific(premium)'],
        ].map(([t, m], i) => (
          <div key={i} style={{
            display: 'flex', gap: 14, padding: '10px 0',
            borderBottom: i < 6 ? '1px solid rgba(14,15,12,.06)' : 'none',
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759',
              minWidth: 56, paddingTop: 2,
            }}>{t}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1C1B17' }}>{m}</span>
          </div>
        ))}
      </div>
    </Card>

    <Card style={{ padding: 20, gridColumn: 'span 2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <Eyebrow>Price floor by section</Eyebrow>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>
          Per Q19 in OPEN_QUESTIONS — floors are per-section.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { tier: 'Premium', floor: '$40',  rows: '4 rows · 80 seats',  offers: 38,  medianAbove: '$58' },
          { tier: 'Mid',     floor: '$18',  rows: '7 rows · 280 seats', offers: 76,  medianAbove: '$26' },
          { tier: 'Rear',    floor: '$10',  rows: '3 rows · 264 seats', offers: 28,  medianAbove: '$14' },
        ].map(t => (
          <div key={t.tier} style={{ background: '#F4F1E8', borderRadius: 8, padding: 14 }}>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: '#0E0F0C', marginBottom: 4 }}>{t.tier}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759', marginBottom: 10 }}>{t.rows}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1C1B17' }}>
              <span>Floor</span><span style={{ color: '#0E0F0C', fontWeight: 600 }}>{t.floor}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1C1B17' }}>
              <span>Median offer above</span><span>{t.medianAbove}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1C1B17' }}>
              <span>Offers compatible</span><span>{t.offers}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  </div>
);

const BigStat = ({ label, value, sub, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: '#6B6759', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 22,
      color: accent ? '#1F4A2E' : '#0E0F0C',
      fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
      fontWeight: accent ? 600 : 400,
    }}>{value}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B' }}>{sub}</span>
  </div>
);

// --- Distribution tab ------------------------------------------------------

const Distribution = () => {
  // Histogram of offer price-per-ticket. Synthetic skew toward $20-40.
  const buckets = [
    { range: '$10-15',  count: 8,  fill: '#9C9789' },
    { range: '$15-20',  count: 14, fill: '#9C9789' },
    { range: '$20-25',  count: 22, fill: '#6A8F6F' },
    { range: '$25-30',  count: 28, fill: '#6A8F6F' },
    { range: '$30-35',  count: 24, fill: '#2D5C3A' },
    { range: '$35-40',  count: 18, fill: '#2D5C3A' },
    { range: '$40-50',  count: 14, fill: '#1F4A2E' },
    { range: '$50-75',  count: 8,  fill: '#1F4A2E' },
    { range: '$75-100', count: 4,  fill: '#0C2014' },
    { range: '$100+',   count: 2,  fill: '#0C2014' },
  ];
  const max = Math.max(...buckets.map(b => b.count));
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
        <Eyebrow>Offer distribution · price per ticket</Eyebrow>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>n=142 · median $28</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, padding: '0 4px 24px',
                    borderBottom: '1px solid rgba(14,15,12,.12)' }}>
        {buckets.map(b => (
          <div key={b.range} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>{b.count}</span>
            <div style={{ width: '100%', height: `${(b.count / max) * 140}px`, background: b.fill, borderRadius: '2px 2px 0 0' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 4px 0' }}>
        {buckets.map(b => (
          <span key={b.range} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6B6759' }}>
            {b.range}
          </span>
        ))}
      </div>
    </Card>
  );
};

// --- Provisional placement tab --------------------------------------------

const ProvisionalPlacement = () => (
  <Card style={{ padding: 24 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
      <Eyebrow>Provisional placement — if allocation ran now</Eyebrow>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>
        487 placed · 14 unplaced · 137 unfilled · 8 orphans
      </span>
    </div>
    <div style={{ background: '#F4F1E8', borderRadius: 8, padding: 24 }}>
      <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.16em', color: '#6B6759', marginBottom: 12 }}>STAGE</div>
      <div style={{ height: 4, background: '#0E0F0C', margin: '0 80px 22px', borderRadius: 2 }} />
      {[
        { tier: 'Premium', rows: ['A', 'AA', 'B', 'BB'] },
        { tier: 'Mid',     rows: ['F', 'G', 'H', 'J', 'K', 'L', 'M'] },
        { tier: 'Rear',    rows: ['N', 'P', 'R'] },
      ].map(sec => (
        <div key={sec.tier} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: '#6B6759', marginBottom: 6 }}>{sec.tier}</div>
          {sec.rows.map(r => <PlacementRow key={r} row={r} />)}
        </div>
      ))}
    </div>
  </Card>
);

const PlacementRow = ({ row }) => (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 3 }}>
    <span style={{ width: 24, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6B6759', textAlign: 'right' }}>{row}</span>
    <div style={{ display: 'flex', gap: 3, flex: 1 }}>
      {Array.from({ length: 22 }, (_, i) => {
        const seed = (row.charCodeAt(0) + i) % 7;
        const cls = seed < 4 ? 'placed' : seed === 4 ? 'unfilled' : seed === 5 ? 'orphan' : 'hold';
        const bg = { placed: '#1F4A2E', unfilled: 'transparent', orphan: '#F2D9D3', hold: '#E8E6DE' }[cls];
        return <div key={i} style={{
          flex: 1, height: 11, borderRadius: 2, background: bg,
          border: cls === 'unfilled' ? '1px dashed rgba(14,15,12,.22)' : 'none',
        }} />;
      })}
    </div>
  </div>
);

// --- Holds tab -------------------------------------------------------------

const Holds = () => (
  <Card style={{ padding: 24 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
      <Eyebrow>Holds — by source</Eyebrow>
      <Button variant="secondary" size="sm" icon="plus">Add hold</Button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[
        ['ADA',         'Row F · seats 1, 2, 27, 28',           4, 'venue', false],
        ['Artist comp', 'Row A · seats 7-12',                   6, 'artist', true],
        ['Production',  'Row BB · seats 1-4 (sound desk)',      4, 'artist', true],
        ['Venue',       'Row M · seats 13-14 (camera platform)', 2, 'venue', false],
      ].map(([source, seats, count, kind, mutable], i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '12px 14px', background: '#F4F1E8', borderRadius: 8,
        }}>
          <Tag tone={kind === 'artist' ? 'brand' : 'neutral'} style={{ minWidth: 76, justifyContent: 'center' }}>
            {source}
          </Tag>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1C1B17', flex: 1 }}>{seats}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6B6759' }}>{count} seats</span>
          {mutable
            ? <button style={{ background: 'transparent', border: 0, cursor: 'pointer', color: '#46443B' }}><Icon name="trash-2" size={14} /></button>
            : <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: '#6B6759', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Read-only</span>
          }
        </div>
      ))}
    </div>
  </Card>
);

// --- Allocation dialog -----------------------------------------------------

const AllocationDialog = ({ onClose, onConfirm }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(14,15,12,.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24,
  }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{
      width: 480, background: '#FFFFFF', borderRadius: 16, padding: 28,
      boxShadow: '0 24px 48px rgba(14,15,12,.20), 0 0 0 1px rgba(14,15,12,.12)',
    }}>
      <Eyebrow style={{ marginBottom: 8 }}>Preview allocation</Eyebrow>
      <h3 style={{ fontSize: 22, marginBottom: 12 }}>Run a non-binding preview?</h3>
      <p style={{ fontSize: 14, color: '#46443B', lineHeight: 1.55, marginBottom: 20 }}>
        The GAE will rank all 142 offers, walk the venue from row A to row R, and
        place groups. <strong style={{ color: '#0E0F0C' }}>Nothing is charged.</strong>
        {' '}You'll see provisional placement and orphans. Run as many previews as you like.
      </p>
      <div style={{
        background: '#F4F1E8', borderRadius: 8, padding: 12, marginBottom: 20,
        fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B', lineHeight: 1.6,
      }}>
        <div>mode=<span style={{ color: '#1F4A2E' }}>preview</span></div>
        <div>orphan_policy=leave</div>
        <div>max_group_size=8</div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="brand" iconAfter="zap" onClick={onConfirm}>Run preview</Button>
      </div>
    </div>
  </div>
);

// --- Fan data tab ---------------------------------------------------------

const FAN_ROWS = [
  ['M. Hernandez',   'm.h@example.com',   '+1 (202) 555-0142', 4, '$54.00', 'placed',   'Row F · 13-16'],
  ['J. Patel',       'jp@example.com',    '+1 (202) 555-0188', 4, '$42.00', 'placed',   'Row AA · 7-10'],
  ['A. Cope',        'ac@example.com',    '+1 (415) 555-0107', 2, '$120.00','placed',   'Row A · 5-6'],
  ['S. Okafor',      'so@example.com',    '+1 (202) 555-0211', 4, '$22.00', 'placed',   'Row H · 9-12'],
  ['B. Lin',         'bl@example.com',    '+1 (202) 555-0344', 3, '$35.00', 'placed',   'Row J · 21-23'],
  ['D. Greenwood',   'dg@example.com',    '+1 (212) 555-0190', 2, '$80.00', 'placed',   'Row AA · 1-2'],
  ['K. Bayer',       'kb@example.com',    '+1 (202) 555-0420', 2, '$28.00', 'placed',   'Row M · 17-18'],
  ['R. Sato',        'rs@example.com',    '+1 (202) 555-0511', 6, '$22.00', 'placed',   'Row L · 7-12'],
  ['T. Williams',    'tw@example.com',    '+1 (202) 555-0632', 4, '$15.00', 'unplaced', 'below tier floors'],
];

const FanData = () => (
  <Card style={{ padding: 0, overflow: 'hidden' }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '18px 24px', borderBottom: '1px solid rgba(14,15,12,.06)',
    }}>
      <div>
        <Eyebrow style={{ marginBottom: 4 }}>Your fans — yours to keep</Eyebrow>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>
          Every fan who submitted an offer. Placed or not. Export any time.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" icon="download">Export CSV</Button>
        <Button variant="secondary" size="sm" icon="mail">Email all 142</Button>
      </div>
    </div>
    <div style={{
      display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1.4fr 60px 100px 110px 1.4fr',
      padding: '12px 24px', background: '#F4F1E8', borderBottom: '1px solid rgba(14,15,12,.06)',
      fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.16em', color: '#6B6759',
    }}>
      <span>Fan</span><span>Email</span><span>Phone</span><span>Grp</span><span>Offer</span><span>Status</span><span>Seats</span>
    </div>
    {FAN_ROWS.map((r, i) => (
      <div key={i} style={{
        display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1.4fr 60px 100px 110px 1.4fr',
        padding: '12px 24px', alignItems: 'center',
        borderBottom: i < FAN_ROWS.length - 1 ? '1px solid rgba(14,15,12,.06)' : 'none',
        fontFamily: 'var(--font-sans)', fontSize: 13, color: '#0E0F0C',
      }}>
        <span style={{ fontWeight: 500 }}>{r[0]}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#46443B' }}>{r[1]}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#46443B' }}>{r[2]}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r[3]}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r[4]}</span>
        <Badge tone={r[5]}>{r[5]}</Badge>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B' }}>{r[6]}</span>
      </div>
    ))}
    <div style={{ padding: '14px 24px', background: '#F4F1E8',
                  fontFamily: 'var(--font-sans)', fontSize: 12, color: '#46443B', borderTop: '1px solid rgba(14,15,12,.06)' }}>
      Showing 9 of 142 · the rest in your CSV export
    </div>
  </Card>
);

// --- Request action dialog ------------------------------------------------

const RequestActionDialog = ({ onClose }) => {
  const [kind, setKind] = React.useState('comp');
  const [details, setDetails] = React.useState('');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(14,15,12,.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 540, background: '#FFFFFF', borderRadius: 16, padding: 28,
        boxShadow: '0 24px 48px rgba(14,15,12,.20), 0 0 0 1px rgba(14,15,12,.12)',
      }}>
        <Eyebrow style={{ marginBottom: 8 }}>Request</Eyebrow>
        <h3 style={{ fontSize: 22, marginBottom: 8 }}>Request a change.</h3>
        <p style={{ fontSize: 13, color: '#46443B', lineHeight: 1.55, marginBottom: 20 }}>
          Auckets is a managed operator — you tell us what you need, we execute and log it.
          Most requests are handled within 30 minutes.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="What do you need?">
            <RadioGroup value={kind} onChange={setKind} options={[
              { value: 'comp',     label: 'Comp specific guests',      hint: 'Family, press, friends. Provide names + emails.' },
              { value: 'override', label: 'Override a placement',      hint: "Move someone, or block someone from being placed." },
              { value: 'pause',    label: 'Pause offers',              hint: 'Stop accepting new offers immediately.' },
              { value: 'end',      label: 'End the offer window early', hint: 'Run binding allocation now instead of T-24.' },
            ]} />
          </Field>

          <Field label="Details">
            <textarea value={details} onChange={(e) => setDetails(e.target.value)}
              placeholder="Tell us what you need, who's involved, and the deadline."
              style={{
                fontFamily: 'var(--font-sans)', fontSize: 14, color: '#0E0F0C',
                background: '#FFFFFF', border: '1px solid rgba(14,15,12,.22)',
                borderRadius: 8, padding: '10px 12px', outline: 'none',
                minHeight: 90, resize: 'vertical',
              }} />
          </Field>
        </div>

        <div style={{
          marginTop: 18, padding: 12, background: '#F4F1E8', borderRadius: 8,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: '#46443B', lineHeight: 1.6,
        }}>
          <div>request_kind={kind}</div>
          <div>logged_to=allocation_audit · append-only</div>
          <div>routes_to=ops@auckets.com + #ops-{`{show_id}`}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="brand" onClick={onClose}>Send to Auckets ops</Button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ShowAdmin });
