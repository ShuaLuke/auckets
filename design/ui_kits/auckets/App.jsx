// =============================================================
// AUCKETS UI Kit — App
// Multi-role click-thru prototype.
//   - fan:    landing → signup → dashboard → show → allocation
//             → ticket viewer → resale flow
//   - artist: dashboard → show admin → create show
//   - admin:  venue builder
//   - venue:  door scanner
// =============================================================

const App = () => {
  const [role, setRole]     = React.useState('fan');
  const [screen, setScreen] = React.useState('landing');
  const [modal, setModal]   = React.useState(null);
  const [user, setUser]     = React.useState(null);
  const [activeShow, setActiveShow] = React.useState(null);
  const [lastOffer, setLastOffer]   = React.useState(null);
  const [finalOutcome, setFinalOutcome] = React.useState('placed');
  const [cardFailureOpen, setCardFailureOpen] = React.useState(false);

  const switchRole = (next) => {
    setRole(next);
    if (next === 'fan')    setScreen('dashboard');
    if (next === 'artist') setScreen('dashboard');
    if (next === 'admin')  setScreen('venues');
    if (next === 'venue')  setScreen('scanner');
  };

  const handleSignUp = (email) => {
    setUser({ email });
    setModal(null);
    setScreen('dashboard');
  };

  const openShow = (show) => { setActiveShow(show); setScreen('show'); };
  const openTicket = (show) => { setActiveShow(show); setLastOffer({ size: 4, price: '42', preview: { row: 'AA', seats: [7,9,11,13], tierName: 'Premium' }}); setScreen('ticket'); };
  const submitOffer = (offer) => { setLastOffer(offer); setScreen('allocation'); };

  return (
    <>
      <Header
        user={user} role={role} current={screen}
        onRoleChange={switchRole}
        onSignIn={() => setModal('signin')}
        onSignUp={() => setModal('signup')}
        onSignOut={() => { setUser(null); setRole('fan'); setScreen('landing'); }}
        onNav={(id) => {
          if (id === 'landing' || !user) { setScreen('landing'); return; }
          if (role === 'fan') {
            if (id === 'dashboard' || id === 'offers') setScreen('dashboard');
          } else if (role === 'artist') {
            if (id === 'dashboard') setScreen('dashboard');
            if (id === 'create')    setScreen('create');
          } else if (role === 'admin') {
            if (id === 'venues') setScreen('venues');
            if (id === 'shows')  setScreen('shows');
          } else if (role === 'venue') {
            setScreen('scanner');
          }
        }}
      />

      {/* MARKETING / LANDING */}
      {!user && screen === 'landing' && (
        <Landing
          onSignUp={() => setModal('signup')}
          onSignIn={() => setModal('signin')}
          onSeeShow={() => setModal('signup')}
        />
      )}

      {/* FAN */}
      {user && role === 'fan' && screen === 'dashboard' && (
        <Dashboard user={user}
          onOpenShow={openShow}
          onOpenTicket={openTicket}
          onSimulateCardFailure={() => setCardFailureOpen(true)} />
      )}
      {user && role === 'fan' && screen === 'show' && activeShow && (
        <Show show={activeShow} onBack={() => setScreen('dashboard')} onSubmit={submitOffer} />
      )}
      {user && role === 'fan' && screen === 'allocation' && activeShow && (
        <Allocation
          show={activeShow} offer={lastOffer}
          onBack={() => setScreen('show')}
          onSeeAll={() => setScreen('dashboard')}
          onSimulateBinding={(outcome) => { setFinalOutcome(outcome); setScreen('allocation-final'); }}
        />
      )}
      {user && role === 'fan' && screen === 'allocation-final' && activeShow && (
        <AllocationFinal
          show={activeShow} offer={lastOffer} outcome={finalOutcome}
          onBack={() => setScreen('dashboard')}
          onSeeAll={() => setScreen('dashboard')}
        />
      )}
      {user && role === 'fan' && screen === 'ticket' && activeShow && (
        <TicketViewer show={activeShow} offer={lastOffer}
          onBack={() => setScreen('dashboard')}
          onResale={() => setScreen('resale')} />
      )}
      {user && role === 'fan' && screen === 'resale' && activeShow && (
        <ResaleFlow show={activeShow} offer={lastOffer}
          onBack={() => setScreen('ticket')}
          onConfirm={() => setScreen('dashboard')} />
      )}

      {/* ARTIST */}
      {user && role === 'artist' && screen === 'dashboard' && (
        <ArtistDashboard
          user={user}
          onOpenShow={(s) => { setActiveShow(s); setScreen('show-admin'); }}
          onCreate={() => setScreen('create')}
        />
      )}
      {user && role === 'artist' && screen === 'show-admin' && activeShow && (
        <ShowAdmin show={activeShow} onBack={() => setScreen('dashboard')} />
      )}
      {user && role === 'artist' && screen === 'create' && (
        <ShowCreate onBack={() => setScreen('dashboard')} onCreate={() => setScreen('dashboard')} />
      )}

      {/* ADMIN */}
      {user && role === 'admin' && (screen === 'venues' || screen === 'shows' || screen === 'venue-builder') && (
        <VenueBuilder onBack={() => switchRole('fan')} />
      )}

      {/* VENUE STAFF (door scanner) */}
      {user && role === 'venue' && (
        <Scanner onBack={() => switchRole('fan')} />
      )}

      {modal && (
        <SignUpModal mode={modal} onClose={() => setModal(null)} onSubmit={handleSignUp} />
      )}

      {cardFailureOpen && activeShow !== null && (
        <CardFailure
          show={SHOWS[0]}
          offer={{ size: 4, price: '42' }}
          onResolved={() => setCardFailureOpen(false)}
          onDismiss={() => setCardFailureOpen(false)}
        />
      )}
      {cardFailureOpen && !activeShow && (
        <CardFailure
          show={SHOWS[0]}
          offer={{ size: 4, price: '42' }}
          onResolved={() => setCardFailureOpen(false)}
          onDismiss={() => setCardFailureOpen(false)}
        />
      )}
    </>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
