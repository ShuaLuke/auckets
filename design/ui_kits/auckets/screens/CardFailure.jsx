// =============================================================
// AUCKETS UI Kit — Card Failure Recovery
// Per product model § 5: ~2% of cards fail at allocation time
// (expired, insufficient funds). Fans get a short window to
// update their payment method and reclaim their seat.
// =============================================================

const CardFailure = ({ show, offer, onResolved, onDismiss }) => {
  const [number, setNumber] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [cvc, setCvc]       = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const submit = () => {
    setWorking(true);
    setTimeout(() => { setWorking(false); setSuccess(true); setTimeout(onResolved, 1300); }, 900);
  };

  if (success) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(14,15,12,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24,
      }}>
        <div style={{
          width: 440, background: '#FFFFFF', borderRadius: 16, padding: 32, textAlign: 'center',
          boxShadow: '0 24px 48px rgba(14,15,12,.20), 0 0 0 1px rgba(14,15,12,.12)',
        }}>
          <div style={{
            width: 56, height: 56, background: '#EEF3EE', borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#1F4A2E', marginBottom: 16,
          }}>
            <Icon name="check" size={28} />
          </div>
          <h3 style={{ fontSize: 22, marginBottom: 8 }}>Your seats are saved.</h3>
          <p style={{ fontSize: 14, color: '#46443B', lineHeight: 1.55 }}>
            We've charged your new card. The seats stay yours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(14,15,12,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24,
    }}>
      <div style={{
        width: 480, background: '#FFFFFF', borderRadius: 16, padding: 28,
        boxShadow: '0 24px 48px rgba(14,15,12,.20), 0 0 0 1px #A93C2A',
      }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18 }}>
          <div style={{
            width: 40, height: 40, background: '#F2D9D3', borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#A93C2A', flexShrink: 0,
          }}>
            <Icon name="alert-triangle" size={20} />
          </div>
          <div>
            <Eyebrow style={{ marginBottom: 6, color: '#A93C2A' }}>Card declined at allocation</Eyebrow>
            <h3 style={{ fontSize: 20, marginBottom: 6 }}>Update your card to keep your seats.</h3>
            <p style={{ fontSize: 13, color: '#46443B', lineHeight: 1.55 }}>
              Your card on file (•••• 4242) was declined when we tried to charge for{' '}
              <strong>{show.venue}</strong>. We've put your seats on a 30-minute hold while you update payment.
            </p>
          </div>
        </div>

        <div style={{
          background: '#F4F1E8', borderRadius: 8, padding: 12, marginBottom: 18,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--font-sans)', fontSize: 13,
        }}>
          <span style={{ color: '#46443B' }}>Seats on hold until</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#A93C2A', fontWeight: 600 }}>
            <Countdown minutes={28} />
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Card number">
            <TextInput value={number} onChange={setNumber} placeholder="1234 5678 9012 3456" mono />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Expiry"><TextInput value={expiry} onChange={setExpiry} placeholder="MM / YY" mono /></Field>
            <Field label="CVC"><TextInput value={cvc} onChange={setCvc} placeholder="123" mono /></Field>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <Button variant="ghost" onClick={onDismiss}>Release seats</Button>
          <Button variant="brand" size="lg" onClick={submit}>
            {working ? 'Charging…' : 'Charge new card'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const Countdown = ({ minutes }) => {
  const [m, setM] = React.useState(minutes);
  const [s, setS] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => {
      setS(prev => {
        if (prev > 0) return prev - 1;
        setM(mm => Math.max(0, mm - 1));
        return 59;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{m}:{String(s).padStart(2, '0')}</span>;
};

Object.assign(window, { CardFailure });
