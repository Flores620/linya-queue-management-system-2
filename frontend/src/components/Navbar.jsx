import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate, Link, NavLink } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo.svg';
import '../styles/Navbar.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

const OFFICE_LABELS = {
  registrar: 'Registrar',
  cashier: 'Cashier',
  principal: "Principal's Office",
};

const OFFICE_ROUTES = {
  registrar: '/Registrardashboard',
  cashier: '/Cashierdashboard',
  principal: '/Principaldashboard',
};

const playChime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    };
    tone(880, ctx.currentTime, 0.15);
    tone(660, ctx.currentTime + 0.18, 0.22);
    setTimeout(() => ctx.close(), 800);
  } catch (e) { /* audio blocked until user interaction */ }
};

function useDismiss(ref, onDismiss, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, logout, selectedOffice, setHighlightedTicketId } = useAuth();

  const officeKey = selectedOffice ? String(selectedOffice).toLowerCase().trim() : '';
  const officeLabel = OFFICE_LABELS[officeKey] || 'Staff';
  const dashboardPath = OFFICE_ROUTES[officeKey];

  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const bellRef = useRef(null);
  const userRef = useRef(null);
  const toastCounter = useRef(0);

  const closeBell = useCallback(() => setBellOpen(false), []);
  const closeUser = useCallback(() => setUserOpen(false), []);
  useDismiss(bellRef, closeBell, bellOpen);
  useDismiss(userRef, closeUser, userOpen);

  useEffect(() => {
    setMenuOpen(false);
    setBellOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast) => {
    toastCounter.current += 1;
    const id = toastCounter.current;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    playChime();
    setTimeout(() => dismissToast(id), 8000);
  }, [dismissToast]);

  const handleNotificationClick = (ticket) => {
    setHighlightedTicketId(ticket.id);
    setBellOpen(false);
    if (dashboardPath && location.pathname !== dashboardPath) navigate(dashboardPath);
  };

  const handleLogout = () => {
    setUserOpen(false);
    setMenuOpen(false);
    logout();
    navigate('/');
  };

  const linkClass = ({ isActive }) => `lnav-link${isActive ? ' active' : ''}`;

  return (
    <>
      <nav className="lnav" aria-label="Main navigation">
        <div className="lnav-inner">
          <Link className="lnav-brand" to="/">
            <img src={logo} alt="" />
            <span>LINYA</span>
          </Link>

          <div className={`lnav-links${menuOpen ? ' open' : ''}`} id="lnav-links">
            <div className="lnav-links-right">
              {!isAuthenticated ? (
                <>
                  <NavLink to="/" end className={linkClass}>HOME</NavLink>
                  <NavLink to="/Login" className={linkClass}>LOGIN</NavLink>
                </>
              ) : (
                <>
                  <NavLink to="/" end className={linkClass}>HOME</NavLink>
                  {dashboardPath && <NavLink to={dashboardPath} className={linkClass}>DASHBOARD</NavLink>}
                </>
              )}
            </div>
          </div>

          <div className="lnav-actions">
            {isAuthenticated && (
              <>
                {/* STAFF MENU */}
                <div className="lnav-dropdown-wrap" ref={userRef}>
                  <button
                    className="lnav-user"
                    onClick={() => { setUserOpen((o) => !o); setBellOpen(false); }}
                    aria-haspopup="true"
                    aria-expanded={userOpen}
                  >
                    <span className="lnav-avatar">{officeLabel.charAt(0).toUpperCase()}</span>
                    <span className="lnav-user-label">{officeLabel}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {userOpen && (
                    <div className="lnav-dropdown lnav-menu" role="menu">
                      <div className="lnav-menu-head">
                        <span className="lnav-menu-sub">Signed in to</span>
                        <strong>{officeLabel}</strong>
                      </div>
                      <button className="lnav-menu-item" role="menuitem" onClick={() => navigate('/')}>View Kiosk</button>
                      <div className="lnav-menu-divider" />
                      <button className="lnav-menu-item danger" role="menuitem" onClick={handleLogout}>Logout</button>
                    </div>
                  )}
                </div>
              </>
            )}

            <button
              className="lnav-toggler"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle navigation menu"
              aria-expanded={menuOpen}
              aria-controls="lnav-links"
            >
              <span className={`lnav-bars${menuOpen ? ' open' : ''}`}><span /><span /><span /></span>
            </button>
          </div>
        </div>
      </nav>

      <div className="lnav-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="lnav-toast priority" role="status">
            <div className="lnav-toast-body">
              <strong>{t.title}</strong>
              <span>{t.text}</span>
            </div>
            <button className="lnav-toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </>
  );
}

export default Navbar;