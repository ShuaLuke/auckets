// =============================================================
// AUCKETS UI Kit — Landing screen
// Hero, "How it works", FAQ. Pulls voice from docs/CONTEXT.md.
// =============================================================

const Landing = ({ onSignUp, onSignIn, onSeeShow }) => {
  return (
    <main style={{ background: '#F4F1E8' }}>
      {/* HERO */}
      <section style={{
        maxWidth: 1080, margin: '0 auto', padding: '88px 32px 56px',
      }}>
        <div style={{ display: 'flex', gap: 64, alignItems: 'flex-end' }}>
          <div style={{ flex: 1.4 }}>
            <Eyebrow style={{ marginBottom: 20 }}>A fairer way to seat a room</Eyebrow>
            <h1 className="display-1" style={{ marginBottom: 24, maxWidth: 720 }}>
              Front row, fair price.<br />
              <span style={{ color: '#46443B' }}>No auctions, no countdowns.</span>
            </h1>
            <p style={{
              fontFamily: 'var(--font-sans)', fontSize: 17, lineHeight: 1.55,
              letterSpacing: '-0.015em', color: '#2C2B25', maxWidth: 540, margin: '0 0 32px',
            }}>
              Submit one offer — your group size, your price per ticket. The
              Greenwood Allocation Engine ranks every offer in the room and
              places groups intelligently, keeping you together.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <MarqueeButton iconAfter="arrow-right" onClick={onSignUp}>
                Create an account
              </MarqueeButton>
              <Button variant="ghost" onClick={onSeeShow}>See an upcoming show →</Button>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <HeroTicketCard />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ background: '#FFFFFF', borderTop: '1px solid rgba(14,15,12,.12)', borderBottom: '1px solid rgba(14,15,12,.12)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 32px' }}>
          <Eyebrow style={{ marginBottom: 12 }}>How it works</Eyebrow>
          <h2 style={{ marginBottom: 40, maxWidth: 600 }}>
            One offer. One ranked allocation. One announced checkpoint.
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {[
              { n: '01', t: 'Submit an offer',
                d: 'Pick your group size and what you\'re willing to pay per ticket. One offer per fan per show. Editable up to 24 hours before allocation.' },
              { n: '02', t: 'See where you\'d land',
                d: 'A non-binding preview shows your seats based on every other offer currently in the room. It updates as offers come in.' },
              { n: '03', t: 'Allocation runs once',
                d: 'At an announced checkpoint, the GAE walks the venue from best row to worst, places ranked groups together, and we charge your card.' },
            ].map(step => (
              <div key={step.n} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1F4A2E',
                  letterSpacing: '0.08em',
                }}>{step.n}</span>
                <h3>{step.t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: '#46443B' }}>{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON BAND */}
      <section style={{
        maxWidth: 1080, margin: '0 auto', padding: '72px 32px',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <Card variant="default" style={{ padding: 28 }}>
            <Eyebrow style={{ marginBottom: 10 }}>Not this</Eyebrow>
            <h3 style={{ marginBottom: 14 }}>An auction.</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'Countdown timers and per-ticket bidding wars',
                'Different prices in the same zone',
                'Strangers between you and your friends',
                'First-come-first-served beats fairness',
              ].map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, color: '#46443B', fontSize: 14, lineHeight: 1.5 }}>
                  <Icon name="x" size={16} color="#A93C2A" style={{ marginTop: 2 }} />{t}
                </li>
              ))}
            </ul>
          </Card>
          <Card variant="outline" style={{ padding: 28, boxShadow: '4px 4px 0 0 #0E0F0C' }}>
            <Eyebrow style={{ marginBottom: 10 }}>This instead</Eyebrow>
            <h3 style={{ marginBottom: 14 }}>A single ranked allocation.</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'One offer per fan per show',
                'Best-ranked groups get the best seats',
                'Groups stay together; orphan seats avoided',
                'Rank is by offer, not by submission time',
              ].map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, color: '#1C1B17', fontSize: 14, lineHeight: 1.5 }}>
                  <Icon name="check" size={16} color="#1F4A2E" style={{ marginTop: 2 }} />{t}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* FOR ARTISTS */}
      <section style={{ background: '#0E0F0C', color: '#F4F1E8' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '72px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 56, alignItems: 'center' }}>
            <div>
              <Eyebrow style={{ marginBottom: 18, color: '#C99A4B' }}>For artists</Eyebrow>
              <h2 style={{ marginBottom: 20, fontSize: 44, color: '#F4F1E8' }}>
                Run a fair room. Earn what the room is worth.
              </h2>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: '#C8C4B7', marginBottom: 16, maxWidth: 520 }}>
                You set the floor per section. Fans submit offers. The Greenwood
                Allocation Engine fills your venue holistically — no zone
                bidding wars, no orphan seats, no opaque dynamic pricing.
              </p>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: '#C8C4B7', marginBottom: 28, maxWidth: 520 }}>
                Every allocation is logged in full. Every override is logged
                with a reason. Your fans see exactly the same thing you do.
              </p>
              <MarqueeButton iconAfter="arrow-right" onClick={onSignUp}
                style={{ background: '#F4F1E8', color: '#0E0F0C', boxShadow: '4px 4px 0 0 #C99A4B' }}>
                Pitch your venue
              </MarqueeButton>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, color: '#9C9789',
              background: '#1C1B17', padding: 22, borderRadius: 12,
              border: '1px solid #2C2B25', lineHeight: 1.8,
            }}>
              <div style={{ color: '#6A8F6F' }}>// allocation_log.json</div>
              <div><span style={{ color: '#E5BC79' }}>"action"</span>: <span style={{ color: '#F4F1E8' }}>"PLACED"</span>,</div>
              <div><span style={{ color: '#E5BC79' }}>"offer_id"</span>: <span style={{ color: '#F4F1E8' }}>"offer_8f3a"</span>,</div>
              <div><span style={{ color: '#E5BC79' }}>"venue_row_id"</span>: <span style={{ color: '#F4F1E8' }}>"row_aa_orch"</span>,</div>
              <div><span style={{ color: '#E5BC79' }}>"seats"</span>: [<span style={{ color: '#F4F1E8' }}>"7","9","11","13"</span>],</div>
              <div><span style={{ color: '#E5BC79' }}>"rank_key"</span>: <span style={{ color: '#F4F1E8' }}>42004</span>,</div>
              <div><span style={{ color: '#E5BC79' }}>"reason"</span>: <span style={{ color: '#F4F1E8' }}>"top of waterfall"</span></div>
              <div style={{ marginTop: 14, color: '#6B6759' }}>Every decision. Every show. Append-only.</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: '#F4F1E8' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '72px 32px' }}>
          <Eyebrow style={{ marginBottom: 16 }}>Common questions</Eyebrow>
          <h2 style={{ marginBottom: 28, fontSize: 36 }}>
            Things people ask before their first offer.
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              ['How is rank calculated?',
                'rank_key = (price_per_ticket_cents × 1000) + group_size. Price wins; group size only breaks ties at equal price. Earliest submission breaks remaining ties.'],
              ['Can I revise my offer?',
                'Yes — upward only, up to 24 hours before binding allocation. Lowering is never allowed. Each revision releases your card auth and creates a new one.'],
              ['What happens if I\'m outbid?',
                'There\'s no "outbid" — there\'s rank. If a lot of higher-ranked offers come in, your provisional placement moves to a lower row, or to "unplaced". You\'ll see this in real time.'],
              ['When am I charged?',
                'When binding allocation runs (24h before doors). Before that, your card is authorized but not charged. If you\'re not placed, the auth is released and you pay $0.'],
              ['What if the show sells out before my offer is competitive?',
                'You\'ll see "unplaced" on the preview and get a notification 24h before binding. You can revise upward; you can\'t go below the tier floor.'],
              ['Are there service fees?',
                'No. The price you offer is the price you pay. Stripe fees come from the artist payout.'],
            ].map(([q, a], i) => (
              <details key={i} style={{
                borderBottom: '1px solid rgba(14,15,12,.12)', padding: '18px 0',
              }}>
                <summary style={{
                  cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 12,
                  fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 500, color: '#0E0F0C',
                  letterSpacing: '-0.01em',
                }}>
                  <span>{q}</span>
                  <Icon name="plus" size={18} color="#6B6759" />
                </summary>
                <p style={{
                  marginTop: 12, fontSize: 14, lineHeight: 1.6, color: '#46443B', maxWidth: 620,
                }}>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#0E0F0C', color: '#9C9789', borderTop: '1px solid #1C1B17' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
            letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#F4F1E8',
          }}>AUCKETS</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>
            Not an auction. © {new Date().getFullYear()} · auckets.com
          </span>
        </div>
      </footer>
    </main>
  );
};

const HeroTicketCard = () => (
  <div style={{
    background: '#FFFFFF', border: '1px solid #0E0F0C', borderRadius: 12,
    padding: 24, position: 'relative', boxShadow: '6px 6px 0 0 #0E0F0C',
  }}>
    <div style={{ position: 'absolute', left: -8, top: '54%', width: 16, height: 16, borderRadius: 999, background: '#F4F1E8', border: '1px solid #0E0F0C' }} />
    <div style={{ position: 'absolute', right: -8, top: '54%', width: 16, height: 16, borderRadius: 999, background: '#F4F1E8', border: '1px solid #0E0F0C' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>Citizen Cope</Eyebrow>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
          Lincoln Theatre
        </div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B', marginTop: 4 }}>
          Washington, DC · Sat May 25 · 8pm
        </div>
      </div>
      <Badge tone="open">Offers open</Badge>
    </div>
    <div style={{ borderTop: '1px dashed #0E0F0C', margin: '20px 0' }} />
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>$42.00</span>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#46443B' }}>× 4 tickets</span>
    </div>
    <div style={{
      marginTop: 14, padding: '8px 12px', background: '#EEF3EE',
      borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#163823',
    }}>
      Preview: Orchestra · Row AA · seats 7–10
    </div>
  </div>
);

Object.assign(window, { Landing });
