import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Queuecard from '../../components/Queuecard';
import '../../styles/KioskTicketScreen.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;
const PRINT_SERVER_URL = (
  import.meta.env.VITE_PRINT_SERVER_URL || LOCAL_SERVER_URL
).replace(/\/+$/, '');

function KioskTicketScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const ticket = location.state?.ticket;
  const [printError, setPrintError] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(15);
  const printRequested = useRef(false);

  useEffect(() => {
    if (!ticket) {
      navigate('/kiosk', { replace: true });
      return undefined;
    }

    const returnToKiosk = window.setTimeout(() => {
      navigate('/kiosk', { replace: true });
    }, 15000);
    const countdown = window.setInterval(() => {
      setSecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    const printKey = `linya-printed-${ticket.id}`;
    if (!printRequested.current && !localStorage.getItem(printKey)) {
      printRequested.current = true;
      fetch(`${PRINT_SERVER_URL}/api/print-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket }),
      })
        .then(async (res) => {
          const result = await res.json();
          if (!res.ok) {
            setPrintError(result.error || 'Printer unavailable. Take a picture of your ticket.');
            return;
          }
          localStorage.setItem(printKey, 'true');
        })
        .catch(() => {
          setPrintError('Printer unavailable. Take a picture of your ticket.');
        });
    }

    return () => {
      window.clearTimeout(returnToKiosk);
      window.clearInterval(countdown);
    };
  }, [ticket, navigate]);

  if (!ticket) return null;

  const handleDone = () => navigate('/kiosk', { replace: true });

  return (
    <main className="kiosk-ticket-screen">
      <Queuecard ticket={ticket} />
      {printError && <p className="kiosk-ticket-print-error" role="alert">{printError}</p>}
      <p className="kiosk-ticket-countdown" role="timer">
        Returning to kiosk in {secondsRemaining} seconds
      </p>
      <button type="button" className="kiosk-ticket-done" onClick={handleDone}>
        Done
      </button>
    </main>
  );
}

export default KioskTicketScreen;
