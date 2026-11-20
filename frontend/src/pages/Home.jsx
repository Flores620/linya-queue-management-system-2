import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/Home.css';

const OFFICE_DETAILS = {
  registrar: {
    label: 'Registrar',
    description: 'Manage student records, enrollment, and registrar queues',
    route: '/Registrardashboard',
    icon: 'R',
  },
  cashier: {
    label: 'Cashier',
    description: 'Manage payments, fees, refunds, and cashier queues',
    route: '/Cashierdashboard',
    icon: 'C',
  },
  principal: {
    label: "Principal's Office",
    description: 'Manage consultations, concerns, and principal office queues',
    route: '/Principaldashboard',
    icon: 'P',
  },
};

function Home() {
  const navigate = useNavigate();
  const { selectedOffice, user, logout } = useAuth();
  const office = OFFICE_DETAILS[selectedOffice];

  const openDisplay = () => {
    window.open('/display', '_blank', 'noopener,noreferrer');
  };

  const openKiosk = () => {
    window.open('/kiosk', '_blank', 'noopener,noreferrer');
  };

  const handleLogout = () => {
    logout();
    navigate('/Login', { replace: true });
  };

  if (!office) {
    return (
      <main className="admin-home admin-home-error">
        <h1>Office not available</h1>
        <button type="button" onClick={handleLogout}>Return to login</button>
      </main>
    );
  }

  return (
    <main className="admin-home">
      <div className="admin-home-container">
        <header className="admin-home-header">
          <div>
            <p className="admin-home-eyebrow">LINYA Administration</p>
            <h1>Welcome, {office.label}</h1>
            <p>Choose where you want to continue.</p>
          </div>
        </header>

        <section className="admin-home-grid" aria-label="Administration navigation">
          <button type="button" className="admin-home-card primary" onClick={() => navigate(office.route)}>
            <span className="admin-home-card-icon">{office.icon}</span>
            <div>
              <h2>Open Dashboard</h2>
              <p>{office.description}</p>
            </div>
            <span className="admin-home-arrow" aria-hidden="true">→</span>
          </button>

          <button type="button" className="admin-home-card" onClick={openDisplay}>
            <span className="admin-home-card-icon display">LIVE</span>
            <div>
              <h2>Public Display</h2>
              <p>View the live queue monitor for students and visitors</p>
            </div>
            <span className="admin-home-arrow" aria-hidden="true">↗</span>
          </button>

          <button type="button" className="admin-home-card" onClick={openKiosk}>
            <span className="admin-home-card-icon kiosk">KIOSK</span>
            <div>
              <h2>Ticket Kiosk</h2>
              <p>Open the self-service ticket station</p>
            </div>
            <span className="admin-home-arrow" aria-hidden="true">↗</span>
          </button>
        </section>

        <footer className="admin-home-meta">
          <span>Signed in as</span>
          <strong>{user?.email || office.label}</strong>
        </footer>
      </div>
    </main>
  );
}

export default Home;
