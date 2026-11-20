import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Queuecard from '../../components/Queuecard';
import { requestPhoneLocation } from '../../utils/phoneLocation.js';
import '../../styles/Purpose.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

function Getticket() {
  const location = useLocation();
  const navigate = useNavigate();
  const { name, studentId, purpose, office, clientType } = location.state || {};

  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [locationRetry, setLocationRetry] = useState(0);
  const hasRun = useRef(false);
  const pendingKey = 'linya-pending-tickets';

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    if (name && purpose && office) {
      const idempotencyKey = `ticket-${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
      const payload = {
        name,
        studentId,
        purpose,
        office,
        clientType,
        requirePhoneLocation: isMobile,
        idempotencyKey,
      };

      const submitTicket = (location) => {
        const requestPayload = { ...payload, location };
        return fetch(`${LOCAL_SERVER_URL}/api/issue-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            const requestError = new Error(data.error || "Server error processing ticket request");
            requestError.status = res.status;
            throw requestError;
          }
          setTicket(data);
          localStorage.setItem(`linya-ticket-${data.claimCode}`, JSON.stringify(data));
          const pending = JSON.parse(localStorage.getItem(pendingKey) || '[]');
          localStorage.setItem(pendingKey, JSON.stringify(
            pending.filter((item) => item.idempotencyKey !== idempotencyKey)
          ));
        })
        .catch((err) => {
          if (err.status && err.status < 500) {
            setError(err.message);
            return;
          }
          const pending = JSON.parse(localStorage.getItem(pendingKey) || '[]');
          if (!pending.some((item) => item.idempotencyKey === idempotencyKey)) {
            localStorage.setItem(pendingKey, JSON.stringify([
              ...pending,
              requestPayload,
            ]));
          }
          setError(err.message === 'Failed to fetch'
            ? 'The local server is unreachable. This ticket request is safely saved on this device and will retry automatically.'
            : err.message);
        });
      };

      (isMobile ? requestPhoneLocation() : Promise.resolve(undefined))
        .then((geoLocation) => submitTicket(geoLocation))
        .catch((locationError) => {
          setError(locationError.message);
        });
    }
  }, [name, studentId, purpose, office, clientType, isMobile, locationRetry]);

  useEffect(() => {
    const retryPending = async () => {
      const pending = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      if (!pending.length) return;
      const remaining = [];
      for (const payload of pending) {
        try {
          const res = await fetch(`${LOCAL_SERVER_URL}/api/issue-ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) remaining.push(payload);
          else {
            const data = await res.json();
            localStorage.setItem(`linya-ticket-${data.claimCode}`, JSON.stringify(data));
          }
        } catch {
          remaining.push(payload);
        }
      }
      localStorage.setItem(pendingKey, JSON.stringify(remaining));
      if (!pending.length || remaining.length === 0) return;
    };
    retryPending();
    const timer = window.setInterval(retryPending, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const handleProceed = () => {
    if (isMobile) {
      navigate('/ticketscreen', { state: { ticket } });
    } else {
      const printKey = `linya-printed-${ticket.id}`;
      if (!localStorage.getItem(printKey)) {
        fetch(`${LOCAL_SERVER_URL}/api/print-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket }),
        })
          .then(async (res) => {
            const result = await res.json();
            if (res.ok) localStorage.setItem(printKey, 'true');
            else setError(result.error || 'Unable to print this ticket.');
          })
          .catch(() => setError('The print service is unreachable. The ticket is still valid.'));
      }
      navigate('/kiosk');
    }
  };

  if (!name || !purpose || !office) {
    return (
      <div className="purpose-container">
        <div className="purpose-content">
          <h3>Error</h3>
          <p>No data found.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="purpose-container">
        <div className="purpose-content">
          <h3 style={{ color: 'red' }}>Connection Fault</h3>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              hasRun.current = false;
              setError(null);
              setLocationRetry((retry) => retry + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="purpose-container">
        <div className="purpose-content">
          <h3>Generating Ticket...</h3>
          {isMobile && <p>Finding your phone's location can take up to 30 seconds. Keep location services on.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="purpose-container">
      <div className="purpose-content">
        <h3>Your Queue Ticket</h3>
        <div className="print-area">
          <Queuecard ticket={ticket} />
        </div>
        <button
          onClick={handleProceed}
          className="btn btn-outline-secondary mt-3"
          style={{ display: 'block', margin: '0 auto' }}
        >
          Proceed
        </button>
        <p style={{ textAlign: 'center' }}>Thank you, {name}! Please wait for your turn.</p>
      </div>
    </div>
  );
}

export default Getticket;
