import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Queuecard from '../../components/Queuecard';
import SpaceGame from '../../components/SpaceGame'; 
import '../../styles/Ticketscreen.css';

// 🔌 IMPORT SOCKET.IO CLIENT
import { io } from 'socket.io-client';

// Dynamically target whichever network machine is running the backend platform
const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

function Ticketscreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { ticket: initialTicket } = location.state || {};

  const [ticket, setTicket] = useState(initialTicket);
  const [activeTab, setActiveTab] = useState('ticket');
  const [servingList, setServingList] = useState([]);

  // --- LOCAL STATE FOR PAUSE LOGIC ---
  const [isGlobalPaused, setIsGlobalPaused] = useState(false);
  const [isPoked, setIsPoked] = useState(false);

  // Reference container to keep the WebSocket stream stable across re-renders
  const socketRef = useRef(null);

  // 1. 📡 CENTRAL REAL-TIME SOCKET ENGINE (Manages Live Updates, Re-calls, and Status Changes)
  useEffect(() => {
    if (!ticket?.studentId) return;

    console.log("📡 Connecting student viewport stream to notification network matrix...");
    socketRef.current = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });

    // A. Listen for full active tickets array to build the Live Serving Board dynamically
    socketRef.current.on('ticketsUpdated', (allTickets) => {
      console.log("📊 Ticket stream array updated:", allTickets);

      // 🎯 TARGETED FILTER: Filter queue list based on this user's assigned office area
      const filteredServing = allTickets.filter(
        t => t.office === ticket.office && t.status === 'Serving'
      );
      setServingList(filteredServing);

      // Sync this specific client's active ticket data state object locally
      const selfMatch = allTickets.find(t => t.id === ticket.id);
      if (selfMatch) {
        // Trigger exit routine if staff marked this ticket item as complete
        if (selfMatch.status === 'Served') {
          alert("Transaction Complete! Thank you for using LINYA.");
          navigate('/', { replace: true });
          return;
        }

        // Fire alert chime notice when status shifts to serving for the first time
        if (selfMatch.status === 'Serving' && ticket.status !== 'Serving') {
          playNotificationSound();
        }

        setTicket(selfMatch);
      }
    });

    // B. Catch direct vocalized/banner re-call notifications targeted strictly to this phone screen
    socketRef.current.on('notifyClientDevice', (payload) => {
      if (payload.studentId === ticket.studentId) {
        console.log("🚨 Target re-call notification packet intercepted:", payload);
        setActiveTab('ticket'); // Instantly kick out of game view back to display board
        playNotificationSound();
        alert(payload.alertMessage || `🔔 ATTENTION: Ticket ${payload.number} is being called to the counter!`);
      }
    });

    // C. Monitor system-wide queue pause states
        socketRef.current.on('pauseStateChanged', (pauseStates) => {
        setIsGlobalPaused(!!pauseStates[ticket.office]);
      });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [ticket?.studentId, ticket?.id, ticket?.status, ticket?.office, navigate]);

  const handlePoke = () => {
    setIsPoked(true);
    setTimeout(() => setIsPoked(false), 1000);
  };

  const playNotificationSound = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.play().catch(e => console.log("Audio play blocked. Interaction required.", e));
  };

  const downloadTicketImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 960;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('LINYA QUEUE TICKET', 360, 90);
    ctx.font = '28px Arial';
    ctx.fillText(String(ticket.office).toUpperCase(), 360, 150);
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(60, 190);
    ctx.lineTo(660, 190);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = 'bold 96px Arial';
    ctx.fillText(ticket.number, 360, 320);
    ctx.textAlign = 'left';
    ctx.font = '28px Arial';
    ctx.fillText(`Name: ${ticket.name}`, 80, 430);
    ctx.fillText(`Client: ${ticket.clientType || 'student'}`, 80, 480);
    ctx.fillText(`Student ID: ${ticket.studentId || 'N/A'}`, 80, 530);
    ctx.fillText(`Purpose: ${ticket.purpose}`, 80, 580);
    ctx.fillText(`Status: ${ticket.status}`, 80, 630);
    ctx.beginPath();
    ctx.moveTo(60, 700);
    ctx.lineTo(660, 700);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '24px Arial';
    ctx.fillText('Please keep this ticket and wait for your turn.', 360, 760);
    ctx.fillText(new Date(ticket.timestamp).toLocaleString(), 360, 820);

    const link = document.createElement('a');
    link.download = `LINYA-${ticket.number}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (!ticket) return null;

  // Determine accent color matches depending on user's office assignment
  const isCashier = ticket.office === 'cashier';
  const officeThemeColor = isCashier ? '#064e3b' : '#1e3a8a';

  return (
    <div className="ticket-screen-container">
      {ticket.status === 'Serving' && (
        <div className="call-notification-banner" onClick={() => playNotificationSound()}>
          🚀 YOU ARE BEING CALLED! Proceed to the Office. (Tap to test audio chime)
        </div>
      )}

      <div className="ticket-tabs">
        <button className={activeTab === 'ticket' ? 'active' : ''} onClick={() => setActiveTab('ticket')}>🎫 TICKET</button>
        <button className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')}>📋 LIST</button>
        <button className={activeTab === 'game' ? 'active' : ''} onClick={() => setActiveTab('game')}>🎮 GAME</button>
      </div>

      <div className="tab-content">
        {activeTab === 'ticket' && (
          <div className="content-fade-in">
            <h3>{ticket.status === 'Serving' ? "NOW SERVING" : "Your Ticket"}</h3>
            <Queuecard ticket={ticket} />
            <button
              type="button"
              onClick={downloadTicketImage}
              className="btn btn-primary"
              style={{ display: 'block', margin: '16px auto' }}
            >
              Download Ticket
            </button>
            <p className={`status-tag ${ticket.status.toLowerCase()}`}>Status: {ticket.status}</p>
          </div>
        )}

        {activeTab === 'list' && (
          <div className="content-fade-in" style={{ position: 'relative' }}>
            {/* Context Header */}
            <h3 style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Live Serving ({ticket.office})
            </h3>

            {isGlobalPaused && (
              <div className="column-pause-overlay">
                <div className={`falling-guy ${isPoked ? 'poked' : ''}`} onClick={handlePoke}>
                  <div className="guy-body">
                    <div className="eyes"><div className="eye"></div><div className="eye"></div></div>
                    <div className="mouth"></div>
                  </div>
                  <div className="speech-bubble">
                    {isPoked ? "OUCH! Resume the line!" : "I'm falling... like the productivity!"}
                  </div>
                </div>
                <p className="pause-subtext">Queue on Hold</p>
              </div>
            )}

            {/* single clean list custom tailored for the visitor's office section */}
            <div className="mini-serving-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
              {servingList.length > 0 ? (
                servingList.map((t) => (
                  <div 
                    key={t.id} 
                    className="mini-item" 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      background: '#ffffff', 
                      padding: '12px 16px', 
                      borderRadius: '8px', 
                      borderLeft: `5px solid ${officeThemeColor}`, 
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)' 
                    }}
                  >
                    <span className="num" style={{ fontWeight: '800', fontSize: '1.1rem', color: '#1e293b' }}>{t.number}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.purpose}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem', padding: '3rem 1rem' }}>
                  Nobody is currently being called in the {ticket.office} department.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'game' && (
          <div className="game-wrapper">
            <SpaceGame ticketStatus={ticket.status} />
            {ticket.status === 'Serving' && (
              <div className="game-interruption">
                <h2>🔔 STOP PLAYING!</h2>
                <p>Your Number {ticket.number} is being called!</p>
                <button onClick={() => setActiveTab('ticket')}>Go to Counter</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Ticketscreen;
