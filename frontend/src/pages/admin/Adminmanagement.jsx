import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../../context/AuthContext.jsx';
import '../../styles/Dashboard.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

const OFFICE_OPTIONS = [
  { id: 'registrar', label: 'Registrar' },
  { id: 'cashier', label: 'Cashier' },
  { id: 'principal', label: "Principal's Office" },
];

const OFFICE_PURPOSES = {
  registrar: [
    'Request of Transcript of Records (TOR)',
    'Request of Certificate of Grades',
    'Request of Good Moral Certificate',
    'Request of Certificate of Enrollment',
    'Request of Diploma',
    'Correction of Records (Name, Birthdate, etc.)',
    'ID Validation / Verification',
  ],
  cashier: [
    'Payment of Tuition',
    'Payment of Enrollment',
    'Payment of Laboratory Fees',
    'Payment of Document Fees',
    'Request for Refund',
  ],
  principal: [
    'Disciplinary Concern / Incident Report',
    'Parent-Teacher Conference Request',
    'Appeal / Grievance Filing',
    'Scholarship Endorsement',
    'Excuse Letter / Absence Justification',
    'School Policy Inquiry',
    'General Consultation',
  ],
};

const Adminmanagement = ({ officeType }) => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [viewMode, setViewMode] = useState('split');
  const [isPaused, setIsPaused] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [emergencyControlsOpen, setEmergencyControlsOpen] = useState(false);

  const { highlightedTicketId, setHighlightedTicketId } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const socketRef = useRef(null);
  const pendingServedTicketId = useRef(null);
  const [arduinoConnected, setArduinoConnected] = useState(false);
  const arduinoPortRef = useRef(null);
  const arduinoReaderRef = useRef(null);
  const arduinoActionsRef = useRef({});

  const latest = useRef({});

  // Transfer modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ office: '', purpose: '', name: '', studentId: '' });
  const [transferError, setTransferError] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const flashTimer = useRef(null);

  useEffect(() => {
    socketRef.current = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });

    socketRef.current.on('ticketsUpdated', (allTickets) => {
      const officeTickets = allTickets.filter(t => t.office === officeType);
      setTickets(officeTickets);

      const servedTicketId = pendingServedTicketId.current;
      if (servedTicketId && officeTickets.some(t => t.id === servedTicketId && t.status === 'Served')) {
        const nextTicket = officeTickets
          .filter(t => ['Waiting', 'Serving'].includes(t.status))
          .sort((a, b) => String(a.queuedAt || a.timestamp).localeCompare(String(b.queuedAt || b.timestamp)))[0] || null;
        pendingServedTicketId.current = null;
        setSelectedTicket(nextTicket);
      }
    });

    socketRef.current.on('pauseStateChanged', (pauseStates) => {
      setIsPaused(!!pauseStates[officeType]);
    });

    socketRef.current.on('closedStateChanged', (closedStates) => {
      setIsClosed(!!closedStates[officeType]);
    });

    return () => {
      socketRef.current.disconnect();
      clearTimeout(flashTimer.current);
    };
  }, [officeType]);

  useEffect(() => {
    if (highlightedTicketId && tickets.length > 0) {
      const ticketToSelect = tickets.find(t => t.id === highlightedTicketId);
      if (ticketToSelect) {
        setSelectedTicket(ticketToSelect);
        setHighlightedTicketId(null);
      }
    }
  }, [highlightedTicketId, tickets]);

  // Keep the open ticket's details in sync with the live data
  useEffect(() => {
    setSelectedTicket(prev =>
      prev ? (tickets.find(t => t.id === prev.id) || null) : prev
    );
  }, [tickets]);

  const servingList = tickets.filter(t => t.status === 'Serving');

  const waitingList = useMemo(() => {
    const term = searchQuery.toLowerCase();
    return tickets
      .filter(t => {
        if (t.status !== 'Waiting') return false;
        if (!searchQuery) return true;
        return (
          t.name?.toLowerCase().includes(term) ||
          t.purpose?.toLowerCase().includes(term) ||
          t.number?.toString().toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        return String(a.queuedAt || a.timestamp).localeCompare(String(b.queuedAt || b.timestamp));
      });
  }, [tickets, searchQuery]);

  const triggerAudioAnnouncement = (ticketNumber, officeName) => {
    if (!window.speechSynthesis) return console.warn("Speech synthesis unsupported on this browser profile.");

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();

      const playTone = (freq, startTime, duration) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(freq, startTime);
        gainNode.gain.setValueAtTime(0.3, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = audioCtx.currentTime;
      playTone(587.33, now, 0.4);
      playTone(440.00, now + 0.25, 0.5);
    } catch (e) {
      console.error("Synthesized AudioContext chime error:", e);
    }

    setTimeout(() => {
      const formattedTicket = ticketNumber.toString().split('').join(' ');
      const textToSpeak = `Ticket number, ${formattedTicket}. Please proceed to the ${officeName} office.`;

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 0.85;
      utterance.pitch = 1.0;

      const systemVoices = window.speechSynthesis.getVoices();
      const cleanVoice = systemVoices.find(v => v.lang.includes('en-US') || v.lang.includes('en-GB'));
      if (cleanVoice) utterance.voice = cleanVoice;

      window.speechSynthesis.speak(utterance);
    }, 700);
  };

  const updateStatus = (id, newStatus) => {
    if (newStatus === 'Served') pendingServedTicketId.current = id;
    socketRef.current.emit('adminUpdateTicketStatus', { id, status: newStatus });
  };

  const executeCallAlertSequence = (ticket, select = true) => {
    if (!ticket) return;

    if (ticket.status !== 'Serving') {
      updateStatus(ticket.id, 'Serving');
    }

    if (select) setSelectedTicket({ ...ticket, status: 'Serving' });

    socketRef.current.emit('notifyClientDevice', {
      ticketId: ticket.id,
      studentId: ticket.studentId,
      number: ticket.number,
      office: officeType,
      alertMessage: `🚨 Your Ticket (${ticket.number}) has been called! Please step up to the Counter.`
    });

    triggerAudioAnnouncement(ticket.number, officeType);
  };

  // ----- Transfer -----
  const openTransfer = () => {
    if (!selectedTicket) return;
    setTransferForm({
      office: '',
      purpose: '',
      name: selectedTicket.name || '',
      studentId: selectedTicket.studentId === 'N/A' ? '' : (selectedTicket.studentId || ''),
    });
    setTransferError('');
    setTransferBusy(false);
    setTransferOpen(true);
  };

  const closeTransfer = () => {
    if (transferBusy) return;
    setTransferOpen(false);
  };

  const updateTransferField = (field) => (e) => {
    const value = field === 'studentId'
      ? e.target.value.replace(/\D/g, '')
      : e.target.value;
    setTransferForm(prev => ({
      ...prev,
      [field]: value,
      ...(field === 'office' ? { purpose: '' } : {}),
    }));
  };

  const showFlash = useCallback((text) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 6000);
  }, []);

  const submitTransfer = (e) => {
    e.preventDefault();
    if (!selectedTicket || transferBusy) return;

    if (!transferForm.office) return setTransferError('Choose an office to transfer to.');
    if (!transferForm.purpose.trim()) return setTransferError('Please enter the reason for the transfer.');
    if (!transferForm.name.trim()) return setTransferError('Name is required.');

    setTransferError('');
    setTransferBusy(true);

    socketRef.current.timeout(8000).emit(
      'adminTransferTicket',
      {
        id: selectedTicket.id,
        newOffice: transferForm.office,
        purpose: transferForm.purpose,
        name: transferForm.name,
        studentId: transferForm.studentId,
      },
      (err, res) => {
        setTransferBusy(false);
        if (err || !res) return setTransferError('The server did not respond. Please try again.');
        if (!res.ok) return setTransferError(res.error || 'Transfer failed.');

        const label = OFFICE_OPTIONS.find(o => o.id === res.office)?.label || res.office;
        setTransferOpen(false);
        setSelectedTicket(null);
        showFlash(`Ticket ${res.previousNumber} transferred to ${label} as ${res.number}.`);
      }
    );
  };

  const callNext = () => {
    if (isPaused || isClosed || waitingList.length === 0) return;
    socketRef.current.timeout(8000).emit(
      'adminCallNext',
      { office: officeType },
      (err, res) => {
        if (err || !res?.ok) {
          showFlash(res?.error || 'The next ticket could not be called.');
          return;
        }
        if (res.ticket) executeCallAlertSequence(res.ticket);
      }
    );
  };

  const callBulk = () => {
    if (isPaused || isClosed || waitingList.length === 0) return;
    const ticketsToCall = waitingList.slice(0, 10);
    socketRef.current.timeout(8000).emit(
      'adminCallBulk',
      { office: officeType, ids: ticketsToCall.map((ticket) => ticket.id), count: ticketsToCall.length },
      (err, res) => {
        if (err || !res?.ok) {
          showFlash(res?.error || 'The bulk call could not be completed.');
          return;
        }
        setSelectedTicket(res.tickets?.[0] ? { ...res.tickets[0], status: 'Serving' } : null);
        res.tickets?.forEach((ticket, index) => {
          setTimeout(() => executeCallAlertSequence(ticket, index === 0), index * 1800);
        });
      }
    );
  };

  const togglePause = () => {
    socketRef.current.emit('adminTogglePause', { office: officeType });
  };

  const toggleQueueOpen = () => {
    const officeLabel = OFFICE_OPTIONS.find((office) => office.id === officeType)?.label || officeType;
    const message = isClosed
      ? `Reopen the ${officeLabel} queue? New ticket requests will be accepted.`
      : `Close the ${officeLabel} queue? New ticket requests will be blocked. Tickets already issued will remain in the queue.`;

    if (window.confirm(message)) {
      socketRef.current.emit('adminToggleQueueOpen', { office: officeType });
    }
  };

  useEffect(() => {
    arduinoActionsRef.current = {
      'CALL NEXT': callNext,
      'BULK CALL': callBulk,
      'PAUSE / RESUME': togglePause,
      'CLOSE / REOPEN': toggleQueueOpen,
    };
  });

  const readArduinoPort = useCallback(async (port) => {
    let reader;

    try {
      if (!port.readable) throw new Error('The Arduino serial port is not readable.');
      reader = port.readable.getReader();
      arduinoReaderRef.current = reader;

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        lines.forEach((line) => {
          const command = line.trim().replace(/^Pressed:\s*/i, '').toUpperCase();
          const action = arduinoActionsRef.current[command];
          if (action) action();
        });
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        showFlash(`Arduino connection error: ${error.message}`);
      }
    } finally {
      if (reader) {
        reader.releaseLock();
        if (arduinoReaderRef.current === reader) arduinoReaderRef.current = null;
      }

      if (arduinoPortRef.current === port) {
        arduinoPortRef.current = null;
        setArduinoConnected(false);
        try {
          await port.close();
        } catch (error) {
          showFlash(`Could not close the Arduino port: ${error.message}`);
        }
      }
    }
  }, [showFlash]);

  const openArduinoPort = useCallback(async (port) => {
    if (arduinoPortRef.current) return;

    let opened = false;
    try {
      await port.open({ baudRate: 9600 });
      opened = true;
      if (!port.readable) throw new Error('The selected port has no readable serial stream.');

      arduinoPortRef.current = port;
      setArduinoConnected(true);
      void readArduinoPort(port);
    } catch (error) {
      if (opened) {
        try {
          await port.close();
        } catch (closeError) {
          console.error('Could not close the Arduino port after connection failed:', closeError);
        }
      }

      const portBusy = /failed to open serial port|access denied|resource busy/i.test(error.message);
      const hint = portBusy
        ? ' Close Arduino IDE Serial Monitor and any other app using the port, then retry.'
        : '';
      showFlash(`Could not connect to Arduino: ${error.message}.${hint}`);
    }
  }, [readArduinoPort, showFlash]);

  const connectArduino = useCallback(async () => {
    if (!('serial' in navigator)) {
      showFlash('Arduino serial access requires Chrome or Edge on localhost or HTTPS.');
      return;
    }

    try {
      const ports = await navigator.serial.getPorts();
      const port = ports.length === 1 ? ports[0] : await navigator.serial.requestPort();
      await openArduinoPort(port);
    } catch (error) {
      if (error.name !== 'NotFoundError') {
        showFlash(`Could not connect to Arduino: ${error.message}`);
      }
    }
  }, [openArduinoPort, showFlash]);

  const disconnectArduino = useCallback(async () => {
    if (!arduinoReaderRef.current) return;
    try {
      await arduinoReaderRef.current.cancel();
    } catch (error) {
      showFlash(`Could not disconnect Arduino: ${error.message}`);
    }
  }, [showFlash]);

  useEffect(() => {
    let active = true;

    const reconnectAuthorizedArduino = async () => {
      if (!('serial' in navigator)) return;
      try {
        const ports = await navigator.serial.getPorts();
        if (active && ports.length === 1) {
          await openArduinoPort(ports[0]);
        }
      } catch (error) {
        if (active) showFlash(`Could not reconnect to Arduino: ${error.message}`);
      }
    };

    void reconnectAuthorizedArduino();

    return () => {
      active = false;
      if (arduinoReaderRef.current) {
        void arduinoReaderRef.current.cancel().catch((error) => {
          console.error('Could not stop the Arduino reader:', error);
        });
      }
    };
  }, [openArduinoPort, showFlash]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || !event.altKey || !event.shiftKey || event.metaKey || event.repeat || transferOpen) return;
      if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;

      const actions = {
        n: callNext,
        b: callBulk,
        p: togglePause,
        o: toggleQueueOpen,
      };
      const action = actions[event.key.toLowerCase()];
      if (!action) return;

      event.preventDefault();
      action();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="admin-layout">
      {/* COLUMN 1: CLIENT DETAILS */}
      <div className="panel-column client-details-area">
        <div className="section-header-modern">
          <span>Client Details
            {isClosed && <span style={{ color: '#b91c1c', marginLeft: '10px', fontWeight: 'bold' }}>— CLOSED</span>}
            {isPaused && <span style={{ color: 'red', marginLeft: '10px', fontWeight: 'bold' }}>— PAUSED</span>}
          </span>
          <button className="btn-transfer" onClick={openTransfer} disabled={!selectedTicket}>
            TRANSFER
          </button>
        </div>

        {flash && <div className="flash-msg" role="status">{flash}</div>}

        <div className="details-scroll-area">
          {selectedTicket ? (
            <div className="details-form-grid wide-view">
              <div className="form-group full-width">
                <label>Full Name</label>
                <div className="form-input">{selectedTicket.name}</div>
              </div>
              <div className="form-group">
                <label>Client Type</label>
                <div className="form-input">
                  {selectedTicket.clientType
                    ? selectedTicket.clientType.charAt(0).toUpperCase() + selectedTicket.clientType.slice(1)
                    : 'Student'}
                </div>
              </div>
              <div className="form-group">
                <label>Student ID</label>
                <div className="form-input">{selectedTicket.studentId || 'N/A'}</div>
              </div>
              <div className="form-group">
                <label>Queue Number</label>
                <div className="form-input highlight-num">{selectedTicket.number}</div>
              </div>
              <div className="form-group">
                <label>Service / Purpose</label>
                <div className="form-input">{selectedTicket.purpose}</div>
              </div>
              <div className="form-group">
                <label>Status</label>
                <div className="form-input badge-input">
                  <span className={`badge ${selectedTicket.status.toLowerCase().replace(/\s+/g, '-')}`}>{selectedTicket.status}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state"><p>Select a ticket to view information</p></div>
          )}
        </div>

        {selectedTicket && (
          <div className="details-footer-center">
            {selectedTicket.status === 'Serving' && (
              <>
                <button
                  className="btn-call-large repeat-call-btn"
                  style={{ backgroundColor: '#e2e8f0', color: '#1e293b', border: '1px solid #cbd5e1' }}
                  onClick={() => executeCallAlertSequence(selectedTicket)}
                >
                  🔄 RE-CALL & NOTIFY
                </button>
                <button
                  className="btn-complete-service"
                  onClick={() => updateStatus(selectedTicket.id, 'Served')}
                >
                  MARK AS SERVED
                </button>
              </>
            )}

            {selectedTicket.status === 'On Hold' && (
              <button
                className="btn-complete-service"
                onClick={() => updateStatus(selectedTicket.id, 'Served')}
              >
                MARK AS SERVED
              </button>
            )}

            {selectedTicket.status === 'Waiting' && (
              <button
                className="btn-call-large"
                onClick={() => executeCallAlertSequence(selectedTicket)}
              >
                CALL & NOTIFY
              </button>
            )}
          </div>
        )}
      </div>

      {/* COLUMN 2: CURRENTLY SERVING */}
      <div className={`panel-column modern-box ${viewMode === 'expand-serving' ? 'full-width' : viewMode === 'expand-queue' ? 'hidden' : ''}`}>
        <div className="box-header-light">
          <h3>Currently Serving</h3>
          <button className="round-toggle"
            onClick={() => setViewMode(viewMode === 'expand-serving' ? 'split' : 'expand-serving')}>
            {viewMode === 'expand-serving' ? '−' : '+'}
          </button>
        </div>
        <div className="card-list">
          {servingList.map(t => (
            <div key={t.id} className={`modern-card ${selectedTicket?.id === t.id ? 'active' : ''}`} onClick={() => setSelectedTicket(t)}>
              <div className="card-num-section">
                <span className="card-val">{t.number}</span>
              </div>
              <div className="card-info-section">
                <span className="card-name">{t.name}</span>
                <span className="card-sub">{t.purpose}</span>
              </div>
              <div className="badge serving">Serving</div>
            </div>
          ))}
        </div>
      </div>

      {/* COLUMN 3: QUEUE LIST */}
      <div className={`panel-column modern-box has-footer ${viewMode === 'expand-queue' ? 'full-width' : viewMode === 'expand-serving' ? 'hidden' : ''}`}>
        <div className="box-header-light">
          <div className="title-group">
            <h3>Queue List</h3>
            <span className="count-sub">({waitingList.length} waiting)</span>
          </div>
          <div className="queue-header-actions">
            <button
              type="button"
              className="btn-emergency-toggle"
              onClick={arduinoConnected ? disconnectArduino : connectArduino}
              aria-pressed={arduinoConnected}
              title="Close Arduino IDE Serial Monitor before connecting."
            >
              {arduinoConnected ? 'Disconnect Uno' : 'Connect Uno'}
              <span className={`queue-status-dot${arduinoConnected ? ' active' : ''}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-emergency-toggle"
              onClick={() => setEmergencyControlsOpen((open) => !open)}
              aria-expanded={emergencyControlsOpen}
              aria-controls="queue-emergency-popover"
            >
              Emergency controls
              <span className={`queue-status-dot${isPaused || isClosed ? ' active' : ''}`} aria-hidden="true" />
            </button>
            <button className="round-toggle"
              onClick={() => setViewMode(viewMode === 'expand-queue' ? 'split' : 'expand-queue')}>
              {viewMode === 'expand-queue' ? '−' : '+'}
            </button>
          </div>
        </div>
        {emergencyControlsOpen && (
          <section
            id="queue-emergency-popover"
            className="queue-emergency-popover"
            aria-label="Emergency queue controls"
          >
            <div className="queue-emergency-heading">
              <span>Emergency controls</span>
              <span className={`queue-status-indicator${isPaused || isClosed ? ' active' : ''}`}>
                {isClosed ? 'Queue closed' : isPaused ? 'Service paused' : 'Queue operational'}
              </span>
              <button
                type="button"
                className="queue-emergency-dismiss"
                onClick={() => setEmergencyControlsOpen(false)}
                aria-label="Close emergency controls"
              >
                ×
              </button>
            </div>
            <div className="queue-emergency-actions">
              <button
                className={`btn-emergency btn-emergency-pause${isPaused ? ' resume' : ''}`}
                onClick={togglePause}
                aria-pressed={isPaused}
                aria-keyshortcuts="Control+Alt+Shift+P"
                title="Arduino shortcut: Ctrl+Alt+Shift+P"
              >
                {isPaused ? 'Resume service' : 'Pause service'}
                <small>{isPaused ? 'Allow calls again' : 'Temporarily stop calls'}</small>
              </button>
              <button
                className={`btn-emergency btn-emergency-close${isClosed ? ' reopen' : ''}`}
                onClick={toggleQueueOpen}
                aria-pressed={isClosed}
                aria-keyshortcuts="Control+Alt+Shift+O"
                title="Arduino shortcut: Ctrl+Alt+Shift+O"
              >
                {isClosed ? 'Reopen queue' : 'Close queue'}
                <small>{isClosed ? 'Accept new tickets' : 'Stop new ticket requests'}</small>
              </button>
            </div>
          </section>
        )}
        <div className="search-container">
          <input type="text" placeholder="Search..."
            className="search-input" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} />
        </div>

        <div className="card-list scrollable">
          {waitingList.length > 0 ? (
            waitingList.map(t => (
              <div
                key={t.id}
                className={`modern-card ${selectedTicket?.id === t.id ? 'active' : ''}`}
                onClick={() => setSelectedTicket(t)}
              >
                <div className="card-num-section">
                  <span className="card-val">{t.number}</span>
                </div>
                <div className="card-info-section">
                  <span className="card-name">{t.name}</span>
                  <span className="card-sub">{t.purpose}</span>
                </div>
                <div className="badge pending">Pending</div>
              </div>
            ))
          ) : <div className="no-results">No matching clients found.</div>}
        </div>

        <div className="modern-action-footer">
          <div className="queue-call-actions">
            <button
              className="btn-call-next"
              onClick={callNext}
              disabled={isPaused || isClosed || waitingList.length === 0}
              aria-keyshortcuts="Control+Alt+Shift+N"
              title="Arduino shortcut: Ctrl+Alt+Shift+N"
            >
              Call next ticket
              <small>One ticket</small>
            </button>
            <button
              className="btn-call-bulk"
              onClick={callBulk}
              disabled={isPaused || isClosed || waitingList.length === 0}
              aria-keyshortcuts="Control+Alt+Shift+B"
              title="Arduino shortcut: Ctrl+Alt+Shift+B"
            >
              Bulk call
              <small>Up to 10 tickets</small>
            </button>
          </div>
        </div>
      </div>

      {/* TRANSFER MODAL */}
      {transferOpen && selectedTicket && (
        <div className="modal-backdrop" onMouseDown={closeTransfer}>
          <form
            className="modal-card"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={submitTransfer}
            onKeyDown={(e) => { if (e.key === 'Escape') closeTransfer(); }}
          >
            <div className="modal-head">
              <div>
                <h3>Transfer Ticket</h3>
                <p>
                  <span className="modal-ticket-number">{selectedTicket.number}</span>
                  <span>from {OFFICE_OPTIONS.find(o => o.id === officeType)?.label}</span>
                </p>
              </div>
              <button type="button" className="modal-x" onClick={closeTransfer} aria-label="Close">×</button>
            </div>

            <div className="modal-body">
              <label className="modal-field">
                <span>Transfer to</span>
                <select value={transferForm.office} onChange={updateTransferField('office')} autoFocus>
                  <option value="" disabled>Select an office</option>
                  {OFFICE_OPTIONS.filter(o => o.id !== officeType).map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="modal-field">
                <span>Reason / purpose</span>
                <select
                  value={transferForm.purpose}
                  onChange={updateTransferField('purpose')}
                  disabled={!transferForm.office}
                >
                  <option value="" disabled>
                    {transferForm.office ? 'Select a reason / purpose' : 'Select an office first'}
                  </option>
                  {(OFFICE_PURPOSES[transferForm.office] || []).map(purpose => (
                    <option key={purpose} value={purpose}>{purpose}</option>
                  ))}
                </select>
              </label>

              <div className="modal-row">
                <label className="modal-field">
                  <span>Full name</span>
                  <input type="text" value={transferForm.name} onChange={updateTransferField('name')} />
                </label>
                <label className="modal-field">
                  <span>Student ID</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={transferForm.studentId}
                    onChange={updateTransferField('studentId')}
                    placeholder="N/A"
                  />
                </label>
              </div>

              <p className="modal-note">
                The ticket will join the back of that office's queue with that office's next ticket number.
              </p>

              {transferError && <div className="modal-error" role="alert">{transferError}</div>}
            </div>

            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" onClick={closeTransfer} disabled={transferBusy}>Cancel</button>
              <button type="submit" className="modal-btn primary" disabled={transferBusy}>
                {transferBusy ? 'Transferring...' : 'Transfer ticket'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Adminmanagement;