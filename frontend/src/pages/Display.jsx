import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import '../styles/Home.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

const OFFICES = [
  { id: 'registrar', label: 'Registrar', className: 'registrar-column' },
  { id: 'cashier', label: 'Cashier', className: 'cashier-column' },
  { id: 'principal', label: "Principal's Office", className: 'principal-column' },
];

function Display() {
  const socketRef = useRef(null);
  const [tickets, setTickets] = useState([]);
  const [pauseStates, setPauseStates] = useState({
    registrar: false,
    cashier: false,
    principal: false,
  });
  const [closedStates, setClosedStates] = useState({
    registrar: false,
    cashier: false,
    principal: false,
  });

  useEffect(() => {
    socketRef.current = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });
    socketRef.current.on('ticketsUpdated', (allTickets) => {
      setTickets(Array.isArray(allTickets) ? allTickets : []);
    });
    socketRef.current.on('pauseStateChanged', setPauseStates);
    socketRef.current.on('closedStateChanged', setClosedStates);
    Promise.all([
      fetch(`${LOCAL_SERVER_URL}/api/pause-states`).then((res) => res.json()),
      fetch(`${LOCAL_SERVER_URL}/api/closed-states`).then((res) => res.json()),
    ]).then(([pauseData, closedData]) => {
      setPauseStates(pauseData);
      setClosedStates(closedData);
    }).catch(() => {});
    return () => socketRef.current?.disconnect();
  }, []);

  const renderQueueColumn = (office) => {
    const active = tickets
      .filter((ticket) =>
        ticket.office === office.id &&
        (ticket.status === 'Serving' || ticket.status === 'Waiting')
      )
      .sort((a, b) => {
        if (a.status === 'Serving' && b.status !== 'Serving') return -1;
        if (a.status !== 'Serving' && b.status === 'Serving') return 1;
        return String(a.queuedAt || a.timestamp).localeCompare(
          String(b.queuedAt || b.timestamp)
        );
      });
    const servingCount = active.filter((ticket) => ticket.status === 'Serving').length;
    const waitingCount = active.length - servingCount;

    return (
      <section key={office.id} className={`display-side-column ${office.className}`}>
        <header className="display-column-header">
          <div>
            <h2>{office.label}</h2>
            <div className="display-queue-counts" aria-label="Queue status counts">
              <span>{active.length} in Queue</span>
              <span>{servingCount} Serving</span>
              <span>{waitingCount} Waiting</span>
            </div>
          </div>
          {closedStates[office.id] ? (
            <strong className="display-status display-closed">CLOSED</strong>
          ) : pauseStates[office.id] ? (
            <strong className="display-status display-paused">BREAK</strong>
          ) : null}
        </header>

        <div className="display-serving-list">
          {active.length ? active.map((ticket) => (
            <article
              key={ticket.id}
              className={`display-ticket ${ticket.status === 'Serving' ? 'serving' : 'waiting'}`}
            >
              <strong>{ticket.number}</strong>
              <span>{ticket.status === 'Serving' ? 'NOW SERVING' : ticket.purpose}</span>
            </article>
          )) : (
            <div className="display-empty">No tickets in line</div>
          )}
        </div>
      </section>
    );
  };

  return (
    <main className="display-layout">
      <section className="display-center">
        <header className="home-header">
          <h1>LINYA QUEUE MANAGEMENT</h1>
          <p className="tagline">Streamlining your campus experience.</p>
        </header>

        <section className="video-section">
          <div className="video-placeholder">
            <iframe
              src="https://www.youtube.com/embed/vM9pNJSRWws?autoplay=1&mute=1&loop=1&playlist=vM9pNJSRWws"
              frameBorder="0"
              allowFullScreen
              title="Queue Stream Display"
            />
          </div>
        </section>

        <section className="tutorial-section">
          <h3>How to get a ticket</h3>
          <div className="steps-container">
            {[
              'Choose your office',
              'Enter student or visitor information',
              'Keep your ticket and wait',
            ].map((text, index) => (
              <div key={text} className="step-card">
                <span className="step-num">{index + 1}</span>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
      </section>

      <aside className="display-queues">
        {OFFICES.map(renderQueueColumn)}
      </aside>
    </main>
  );
}

export default Display;
