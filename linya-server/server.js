const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const PDFDocument = require('pdfkit');

const OFFICES = ['registrar', 'cashier', 'principal'];
const PREFIX = { registrar: 'R-', cashier: 'C-', principal: 'P-' };
const OFFICE_LABELS = { registrar: 'Registrar', cashier: 'Cashier', principal: "Principal's Office" };
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'queue-data.json');

function historyOffice(ticket) {
  if (!ticket?.isTransferred) return ticket?.office;
  if (OFFICES.includes(ticket.transferredFrom)) return ticket.transferredFrom;
  const originalNumber = String(ticket.originalNumber || ticket.previousNumber || '');
  if (originalNumber.startsWith(PREFIX.registrar)) return 'registrar';
  if (originalNumber.startsWith(PREFIX.cashier)) return 'cashier';
  if (originalNumber.startsWith(PREFIX.principal)) return 'principal';
  return ticket.office;
}

function belongsToHistoryOffice(ticket, office) {
  if (!ticket || !OFFICES.includes(office)) return false;
  if (!ticket.isTransferred) return ticket.office === office;

  const source = historyOffice(ticket);
  const destination = OFFICES.includes(ticket.transferredTo)
    ? ticket.transferredTo
    : ticket.office;
  return office === source || office === destination;
}

function historyTransferLabel(ticket, office) {
  if (!ticket?.isTransferred) return '';
  const source = historyOffice(ticket);
  const destination = OFFICES.includes(ticket.transferredTo) ? ticket.transferredTo : ticket.office;
  if (source === office) return `TRANSFERRED TO ${OFFICE_LABELS[destination] || destination}`;
  if (destination === office) return `TRANSFERRED FROM ${OFFICE_LABELS[source] || source}`;
  return 'TRANSFERRED';
}

function historyStatus(ticket, office) {
  return ticket?.isTransferred && historyOffice(ticket) === office ? 'Served' : ticket?.status;
}

function historyTicketNumber(ticket, office) {
  if (ticket?.isTransferred && historyOffice(ticket) === office) {
    return ticket.previousNumber || ticket.originalNumber || ticket.number;
  }
  return ticket?.number;
}
const PRINT_DIR = path.join(DATA_DIR, 'print-jobs');
fs.mkdirSync(PRINT_DIR, { recursive: true });
const LOCATION_RADIUS_METERS = Number(process.env.CAMPUS_RADIUS_METERS || 500);
const CAMPUS = {
  latitude: Number(process.env.CAMPUS_LATITUDE || 10.4892949),
  longitude: Number(process.env.CAMPUS_LONGITUDE || 123.7117279),
};

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
let firestoreEnabled = false;

function initFirestore() {
  try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    let credential;
    if (process.env.FIREBASE_KEY) credential = cert(JSON.parse(process.env.FIREBASE_KEY));
    else if (fs.existsSync(path.join(__dirname, 'firebase-key.json'))) {
      credential = cert(require(path.join(__dirname, 'firebase-key.json')));
    } else return;
    const app = getApps().length ? getApps()[0] : initializeApp({ credential });
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    firestoreEnabled = true;
    console.log('Firebase cloud backup enabled.');
  } catch (error) {
    console.log('Firebase cloud backup unavailable:', error.message);
  }
}
initFirestore();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*' }));
app.use(express.json({ limit: '1mb' }));

const tlsCertPath = process.env.LOCAL_TLS_CERT_PATH;
const tlsKeyPath = process.env.LOCAL_TLS_KEY_PATH;
if (!!tlsCertPath !== !!tlsKeyPath) {
  throw new Error('Set both LOCAL_TLS_CERT_PATH and LOCAL_TLS_KEY_PATH to enable local HTTPS.');
}
const server = tlsCertPath
  ? https.createServer({
    cert: fs.readFileSync(tlsCertPath),
    key: fs.readFileSync(tlsKeyPath),
  }, app)
  : http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

function defaultState() {
  return {
    tickets: [],
    counters: { registrar: {}, cashier: {}, principal: {} },
    pauseStates: { registrar: false, cashier: false, principal: false },
    closedStates: { registrar: false, cashier: false, principal: false },
    officeStateUpdatedAt: new Date(0).toISOString(),
    cloudSyncInitializedAt: null,
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      counters: parsed.counters || defaultState().counters,
      pauseStates: parsed.pauseStates || defaultState().pauseStates,
      closedStates: parsed.closedStates || defaultState().closedStates,
      officeStateUpdatedAt: parsed.officeStateUpdatedAt || new Date(0).toISOString(),
      cloudSyncInitializedAt: parsed.cloudSyncInitializedAt || null,
    };
  } catch (error) {
    console.error('Could not read local queue backup:', error.message);
    return defaultState();
  }
}

let state = loadState();
let lastScheduleKey = '';
let lastRolloverDate = '';
let cloudSyncInProgress = false;
let cloudSyncLastSuccess = null;
let cloudSyncError = null;
let cloudSyncReady = !firestoreEnabled || Boolean(state.cloudSyncInitializedAt);

function persist() {
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function cloudWrite(doc, value) {
  if (!firestoreEnabled) return;
  db.collection(doc).doc(value.id).set(value).catch((error) => {
    cloudSyncError = error.message;
    console.log('Cloud backup deferred:', error.message);
  });
}

function cloudWriteCounter(office, dateKey) {
  if (!firestoreEnabled) return;
  db.collection('counters').doc(`${office}_${dateKey}`).set({
    office,
    date: dateKey,
    lastNumber: state.counters[office][dateKey] || 0,
    isPaused: state.pauseStates[office],
    isClosed: state.closedStates[office],
  }, { merge: true }).catch((error) => {
    cloudSyncError = error.message;
    console.log('Cloud counter backup deferred:', error.message);
  });
}

function cloudWriteOfficeState() {
  if (!firestoreEnabled) return;
  db.collection('queueState').doc('current').set({
    pauseStates: state.pauseStates,
    closedStates: state.closedStates,
    updatedAt: state.officeStateUpdatedAt,
  }, { merge: true }).catch((error) => {
    cloudSyncError = error.message;
    console.log('Cloud office state backup deferred:', error.message);
  });
}

function ticketVersion(ticket) {
  const updatedAt = Date.parse(ticket.updatedAt || '');
  if (Number.isFinite(updatedAt)) return updatedAt;
  const timestamps = [
    ticket.transferredAt,
    ticket.completedAt,
    ticket.servingAt,
    ticket.queuedAt,
    ticket.timestamp,
  ].map((value) => Date.parse(value || '')).filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function syncFirestoreState() {
  if (!firestoreEnabled || cloudSyncInProgress) return;
  cloudSyncInProgress = true;

  try {
    const [cloudTickets, cloudCounters, cloudOfficeState] = await Promise.all([
      db.collection('tickets').get(),
      db.collection('counters').get(),
      db.collection('queueState').doc('current').get(),
    ]);

    let localChanged = false;
    let ticketsChanged = false;
    let schedulesChanged = false;
    const ticketWrites = [];
    const remoteTicketById = new Map();

    cloudTickets.forEach((doc) => {
      remoteTicketById.set(doc.id, { ...doc.data(), id: doc.id });
    });

    const localTicketById = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
    for (const [id, remoteTicket] of remoteTicketById) {
      const localTicket = localTicketById.get(id);
      if (!localTicket) {
        state.tickets.push(remoteTicket);
        localChanged = true;
        ticketsChanged = true;
      } else if (ticketVersion(remoteTicket) > ticketVersion(localTicket)) {
        const index = state.tickets.findIndex((ticket) => ticket.id === id);
        state.tickets[index] = remoteTicket;
        localChanged = true;
        ticketsChanged = true;
      } else if (stableStringify(localTicket) !== stableStringify(remoteTicket)) {
        ticketWrites.push(localTicket);
      }
    }

    for (const localTicket of state.tickets) {
      if (!remoteTicketById.has(localTicket.id)) ticketWrites.push(localTicket);
    }

    const remoteCounters = new Map();
    cloudCounters.forEach((doc) => {
      const counter = doc.data();
      if (!OFFICES.includes(counter.office) || !counter.date) return;
      const key = `${counter.office}_${counter.date}`;
      remoteCounters.set(key, counter);
      state.counters[counter.office] ||= {};
      const localCount = state.counters[counter.office][counter.date] || 0;
      if (counter.lastNumber > localCount) {
        state.counters[counter.office][counter.date] = counter.lastNumber;
        localChanged = true;
      }
    });

    const counterWrites = [];
    OFFICES.forEach((office) => {
      Object.entries(state.counters[office] || {}).forEach(([date, lastNumber]) => {
        const key = `${office}_${date}`;
        if (!remoteCounters.has(key) || lastNumber > (remoteCounters.get(key).lastNumber || 0)) {
          counterWrites.push({
            id: key,
            office,
            date,
            lastNumber,
            isPaused: state.pauseStates[office],
            isClosed: state.closedStates[office],
          });
        }
      });
    });

    const remoteState = cloudOfficeState.exists ? cloudOfficeState.data() : null;
    const localStateVersion = Date.parse(state.officeStateUpdatedAt || '') || 0;
    const remoteStateVersion = Date.parse(remoteState?.updatedAt || '') || 0;
    if (remoteState && remoteStateVersion > localStateVersion) {
      state.pauseStates = { ...state.pauseStates, ...(remoteState.pauseStates || {}) };
      state.closedStates = { ...state.closedStates, ...(remoteState.closedStates || {}) };
      state.officeStateUpdatedAt = remoteState.updatedAt;
      localChanged = true;
      schedulesChanged = true;
    }

    if (localChanged) persist();
    if (ticketsChanged) broadcastTickets();
    if (schedulesChanged) {
      io.emit('pauseStateChanged', { ...state.pauseStates });
      io.emit('closedStateChanged', { ...state.closedStates });
      io.emit('officeStatesUpdated', {
        pauseStates: { ...state.pauseStates },
        closedStates: { ...state.closedStates },
      });
    }

    const writes = [];
    ticketWrites.forEach((ticket) => {
      if (ticket) writes.push({ ref: db.collection('tickets').doc(ticket.id), value: ticket });
    });
    counterWrites.forEach((counter) => {
      writes.push({ ref: db.collection('counters').doc(counter.id), value: counter });
    });

    const localOfficeState = {
      pauseStates: state.pauseStates,
      closedStates: state.closedStates,
      updatedAt: state.officeStateUpdatedAt,
    };
    if (!remoteState || localStateVersion >= remoteStateVersion) {
      if (stableStringify(localOfficeState) !== stableStringify(remoteState || null)) {
        writes.push({ ref: db.collection('queueState').doc('current'), value: localOfficeState });
      }
    }

    for (const group of chunks(writes, 450)) {
      const batch = db.batch();
      group.forEach(({ ref, value }) => batch.set(ref, value));
      await batch.commit();
    }

    cloudSyncLastSuccess = new Date().toISOString();
    cloudSyncError = null;
    if (!state.cloudSyncInitializedAt) {
      state.cloudSyncInitializedAt = cloudSyncLastSuccess;
      persist();
    }
    cloudSyncReady = true;
  } catch (error) {
    cloudSyncError = error.message;
    console.error('Firestore synchronization deferred:', error.message);
  } finally {
    cloudSyncInProgress = false;
  }
}

function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeStudentId(value) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function haversineMeters(a, b) {
  const rad = (n) => n * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function broadcastTickets() { io.emit('ticketsUpdated', state.tickets); }
function broadcastSchedules() {
  state.officeStateUpdatedAt = new Date().toISOString();
  persist();
  cloudWriteOfficeState();
  io.emit('pauseStateChanged', { ...state.pauseStates });
  io.emit('closedStateChanged', { ...state.closedStates });
  io.emit('officeStatesUpdated', {
    pauseStates: { ...state.pauseStates },
    closedStates: { ...state.closedStates },
  });
}

function applyDailyRollover() {
  const now = new Date();
  if (now.getHours() < 16) return;

  const dateKey = toDateKey(now);
  if (dateKey === lastRolloverDate) return;

  let changed = 0;
  state.tickets.forEach((ticket) => {
    if (['Waiting', 'Serving', 'On Hold'].includes(ticket.status)) {
      ticket.status = 'Expired';
      ticket.completedAt = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        16,
        0,
        0
      ).toISOString();
      ticket.updatedAt = ticket.completedAt;
      ticket.expiredReason = 'Not claimed before next office day';
      changed += 1;
      cloudWrite('tickets', ticket);
    }
  });

  lastRolloverDate = dateKey;
  persist();
  if (changed) broadcastTickets();
  console.log(`Daily rollover complete: ${changed} unresolved ticket(s) marked Expired.`);
}

function applyOfficeSchedule() {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const openMinute = 8 * 60;
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60;
  const closeMinute = 16 * 60;
  const beforeOpen = minute < openMinute;
  const atLunch = minute >= lunchStart && minute < lunchEnd;
  const afterClose = minute >= closeMinute;

  const scheduleKey = `${toDateKey(now)}-${beforeOpen}-${atLunch}-${afterClose}`;
  if (scheduleKey === lastScheduleKey) return;
  lastScheduleKey = scheduleKey;
  OFFICES.forEach((office) => {
    state.closedStates[office] = beforeOpen || afterClose;
    state.pauseStates[office] = atLunch;
  });
  persist();
  broadcastSchedules();
  console.log(`Schedule applied: ${beforeOpen ? 'not open' : afterClose ? 'closed' : atLunch ? 'lunch pause' : 'open'}`);
}

applyOfficeSchedule();
applyDailyRollover();
syncFirestoreState();
setInterval(() => {
  applyOfficeSchedule();
  applyDailyRollover();
  syncFirestoreState();
}, 30 * 1000);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: firestoreEnabled ? 'online-with-local-backup' : 'local-only',
    cloudSync: {
      enabled: firestoreEnabled,
      ready: cloudSyncReady,
      inProgress: cloudSyncInProgress,
      lastSuccess: cloudSyncLastSuccess,
      error: cloudSyncError,
    },
    date: toDateKey(),
    offices: OFFICES,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const accounts = [
    { email: process.env.REGISTRAR_EMAIL || 'registrar@school.edu', password: process.env.REGISTRAR_PASSWORD || 'password123', office: 'registrar' },
    { email: process.env.CASHIER_EMAIL || 'cashier@school.edu', password: process.env.CASHIER_PASSWORD || 'password123', office: 'cashier' },
    { email: process.env.PRINCIPAL_EMAIL || 'principal@school.edu', password: process.env.PRINCIPAL_PASSWORD || 'password123', office: 'principal' },
  ];
  const account = accounts.find((u) => u.email.toLowerCase() === String(email || '').toLowerCase() && u.password === password);
  if (!account) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ success: true, user: { email: account.email, office: account.office } });
});

app.get('/api/tickets/search/:studentId', (req, res) => {
  const studentId = normalizeStudentId(req.params.studentId);
  const ticket = state.tickets
    .filter((t) => normalizeStudentId(t.studentId) === studentId && ['Waiting', 'Serving'].includes(t.status))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
  if (!ticket) return res.status(404).json({ error: 'No active ticket found.' });
  res.json(ticket);
});

app.get('/api/tickets/claim/:claimCode', (req, res) => {
  const ticket = state.tickets.find((t) => t.claimCode === req.params.claimCode);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  res.json(ticket);
});

app.get('/api/tickets/history/:office', (req, res) => {
  const history = state.tickets
    .filter((t) => belongsToHistoryOffice(t, req.params.office))
    .sort((a, b) => String(b.completedAt || b.transferredAt || b.timestamp).localeCompare(String(a.completedAt || a.transferredAt || a.timestamp)));
  res.json(history);
});

app.get('/api/tickets/history/:office/export', (req, res) => {
  const { period = 'all', value } = req.query;
  const reportValue = String(value || '');
  if (!OFFICES.includes(req.params.office)) {
    return res.status(400).json({ error: 'Invalid office for report.' });
  }

  if (period === 'daily') {
    const [year, month, day] = reportValue.split('-').map(Number);
    const reportDate = new Date(year, month - 1, day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportValue) ||
        reportDate.getFullYear() !== year ||
        reportDate.getMonth() !== month - 1 ||
        reportDate.getDate() !== day) {
      return res.status(400).json({ error: 'Choose a valid date for the daily report.' });
    }
  } else if (period === 'monthly') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportValue)) {
      return res.status(400).json({ error: 'Choose a valid month for the monthly report.' });
    }
  } else if (period === 'yearly') {
    if (!/^\d{4}$/.test(reportValue) || Number(reportValue) < 1) {
      return res.status(400).json({ error: 'Choose a valid year for the yearly report.' });
    }
  } else if (period !== 'all') {
    return res.status(400).json({ error: 'Choose a supported report period.' });
  }

  const rows = state.tickets
    .filter((ticket) => {
      if (!belongsToHistoryOffice(ticket, req.params.office)) return false;
      if (period === 'all') return true;

      const completedAt = new Date(ticket.completedAt || ticket.transferredAt || ticket.timestamp);
      if (Number.isNaN(completedAt.getTime())) return false;
      const dateKey = toDateKey(completedAt);
      if (period === 'daily') return dateKey === reportValue;
      if (period === 'monthly') return dateKey.startsWith(reportValue);
      return dateKey.startsWith(reportValue);
    })
    .sort((a, b) => String(b.completedAt || b.transferredAt || b.timestamp).localeCompare(String(a.completedAt || a.transferredAt || a.timestamp)));

  const header = ['Ticket #', 'Name', 'Student ID', 'Purpose', 'Transfer', 'Status', 'Activity'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    header.join(','),
    ...rows.map((t) => [
      historyTicketNumber(t, req.params.office),
      t.name,
      t.studentId || 'N/A',
      t.purpose,
      historyTransferLabel(t, req.params.office),
      historyStatus(t, req.params.office),
      new Date(t.completedAt || t.transferredAt || t.timestamp)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    ].map(escape).join(',')),
  ].join('\n');
  const periodSuffix = period === 'all' ? `history-${toDateKey()}` : `${period}-${reportValue}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.office}-${periodSuffix}.csv"`);
  res.send(csv);
});

app.get('/api/pause-states', (req, res) => res.json({ ...state.pauseStates }));
app.get('/api/closed-states', (req, res) => res.json({ ...state.closedStates }));

app.get('/api/printer/status', async (req, res) => {
  try {
    const printer = require('pdf-to-printer');
    const printers = await printer.getPrinters();
    res.json({
      configuredPrinter: process.env.LINYA_PRINTER || null,
      printers,
      ready: printers.length > 0,
    });
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

app.post('/api/print-ticket', async (req, res) => {
  const ticket = req.body?.ticket;
  if (!ticket?.id || !ticket?.number) {
    return res.status(400).json({ error: 'A valid ticket is required.' });
  }

  const jobId = `${ticket.id}-${Date.now()}`;
  const pdfPath = path.join(PRINT_DIR, `${jobId}.pdf`);
  const jobPath = path.join(PRINT_DIR, `${jobId}.json`);
  const job = {
    id: jobId,
    ticketId: ticket.id,
    ticketNumber: ticket.number,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };

  try {
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [226.8, 566.9], margins: { top: 20, bottom: 20, left: 18, right: 18 } });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);
      doc.font('Helvetica-Bold').fontSize(16).text('LINYA QUEUE TICKET', { align: 'center' });
      doc.moveDown(0.35);
      doc.font('Helvetica').fontSize(10).text(String(ticket.office || '').toUpperCase(), { align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(34).text(ticket.number, { align: 'center' });
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Name: ${ticket.name || ''}`);
      doc.text(`Client: ${ticket.clientType || 'student'}`);
      doc.text(`Student ID: ${ticket.studentId || 'N/A'}`);
      doc.text(`Purpose: ${ticket.purpose || ''}`);
      doc.moveDown();
      doc.text('Please wait for your turn.', { align: 'center' });
      doc.text(new Date(ticket.timestamp || Date.now()).toLocaleString(), { align: 'center' });
      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    const printer = require('pdf-to-printer');
    const options = process.env.LINYA_PRINTER ? { printer: process.env.LINYA_PRINTER } : {};
    await printer.print(pdfPath, options);
    job.status = 'printed';
    job.completedAt = new Date().toISOString();
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
    res.json({ ok: true, job });
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
    res.status(503).json({ ok: false, error: 'Printer unavailable. Ticket remains valid.', job });
  }
});

app.post('/api/issue-ticket', (req, res) => {
  if (!cloudSyncReady) {
    return res.status(503).json({
      error: 'Initial Firestore sync has not completed. Connect to the internet and try again.',
    });
  }

  const {
    name, studentId, purpose, office, clientType = 'student',
    location, requirePhoneLocation, idempotencyKey,
  } = req.body;
  if (!OFFICES.includes(office)) return res.status(400).json({ error: 'Invalid office.' });
  if (state.closedStates[office]) return res.status(409).json({ error: 'This office queue is closed.' });
  if (state.pauseStates[office]) return res.status(409).json({ error: 'This office is currently on lunch break.' });
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!String(purpose || '').trim()) return res.status(400).json({ error: 'Purpose is required.' });

  const normalizedType = clientType === 'visitor' ? 'visitor' : 'student';
  const normalizedId = normalizedType === 'student' ? normalizeStudentId(studentId) : '';
  if (normalizedType === 'student' && !normalizedId) {
    return res.status(400).json({ error: 'Student ID is required.' });
  }

  if (normalizedType === 'student') {
    const duplicate = state.tickets.find((t) =>
      normalizeStudentId(t.studentId) === normalizedId &&
      t.office === office &&
      ['Waiting', 'Serving', 'On Hold'].includes(t.status)
    );
    if (duplicate) return res.status(409).json({
      error: 'This Student ID already has an active ticket.',
      ticket: duplicate,
    });
  }

  const phoneRequest = requirePhoneLocation === true ||
    location?.fromPhone === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(req.get('user-agent') || '');

  if (phoneRequest) {
    if (location?.fromPhone !== true) {
      return res.status(400).json({ error: 'Phone location is required to issue a ticket. Allow location access and try again.' });
    }

    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'The phone returned invalid coordinates. Check location access and try again.' });
    }

    const distance = haversineMeters({ latitude: lat, longitude: lon }, CAMPUS);
    if (distance > LOCATION_RADIUS_METERS) {
      return res.status(403).json({
        error: `You are outside the allowed ticket area. Distance: ${Math.round(distance)} m; allowed radius: ${LOCATION_RADIUS_METERS} m.`,
      });
    }
  }

  if (idempotencyKey) {
    const existing = state.tickets.find((t) => t.idempotencyKey === idempotencyKey);
    if (existing) return res.json(existing);
  }

  const dateKey = toDateKey();
  state.counters[office] ||= {};
  state.counters[office][dateKey] = (state.counters[office][dateKey] || 0) + 1;
  const num = state.counters[office][dateKey];
  const now = new Date().toISOString();
  const claimCode = crypto.randomBytes(5).toString('hex').toUpperCase();
  const ticket = {
    id: crypto.randomUUID(),
    claimCode,
    idempotencyKey: idempotencyKey || null,
    number: `${PREFIX[office]}${String(num).padStart(3, '0')}`,
    office,
    purpose: String(purpose).trim(),
    status: 'Waiting',
    name: String(name).trim(),
    clientType: normalizedType,
    studentId: normalizedType === 'student' ? normalizedId : 'N/A',
    isPriority: false,
    isTransferred: false,
    transferredFrom: null,
    timestamp: now,
    queuedAt: now,
    updatedAt: now,
  };

  state.tickets.push(ticket);
  persist();
  res.status(201).json(ticket);
  broadcastTickets();
  cloudWrite('tickets', ticket);
  cloudWriteCounter(office, dateKey);
});

io.on('connection', (socket) => {
  socket.emit('ticketsUpdated', state.tickets);
  socket.emit('pauseStateChanged', { ...state.pauseStates });
  socket.emit('closedStateChanged', { ...state.closedStates });

  socket.on('adminUpdateTicketStatus', ({ id, status }) => {
    const allowed = ['Waiting', 'Serving', 'On Hold', 'Served', 'Cancelled', 'Expired'];
    const ticket = state.tickets.find((t) => t.id === id);
    if (!ticket || !allowed.includes(status)) return;
    const updatedAt = new Date().toISOString();
    ticket.status = status;
    ticket.updatedAt = updatedAt;
    if (['Served', 'Cancelled', 'Expired'].includes(status)) ticket.completedAt = updatedAt;
    persist();
    broadcastTickets();
    cloudWrite('tickets', ticket);
  });

  socket.on('adminCallNext', ({ office }, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!cloudSyncReady) {
      return reply({ ok: false, error: 'Initial Firestore sync has not completed. Please try again shortly.' });
    }
    if (!OFFICES.includes(office)) {
      return reply({ ok: false, error: 'A valid office is required to call the next ticket.' });
    }
    if (state.pauseStates[office] || state.closedStates[office]) {
      return reply({ ok: false, error: 'Resume the queue before calling tickets.' });
    }
    const ticket = state.tickets
      .filter((t) => t.office === office && t.status === 'Waiting')
      .sort((a, b) => String(a.queuedAt || a.timestamp).localeCompare(String(b.queuedAt || b.timestamp)))[0];
    if (!ticket) return reply({ ok: false, error: 'There are no waiting tickets in this queue.' });

    ticket.status = 'Serving';
    ticket.servingAt = new Date().toISOString();
    ticket.updatedAt = ticket.servingAt;
    cloudWrite('tickets', ticket);
    persist();
    broadcastTickets();
    reply({ ok: true, ticket });
  });

  socket.on('adminCallBulk', ({ office, ids, count = 10 }, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!cloudSyncReady) {
      return reply({ ok: false, error: 'Initial Firestore sync has not completed. Please try again shortly.' });
    }
    if (!OFFICES.includes(office)) {
      return reply({ ok: false, error: 'Queue cannot be called.' });
    }
    if (state.pauseStates[office] || state.closedStates[office]) {
      return reply({ ok: false, error: 'Resume the queue before calling tickets.' });
    }
    let candidates = state.tickets
      .filter((ticket) => ticket.office === office && ticket.status === 'Waiting')
      .sort((a, b) => String(a.queuedAt || a.timestamp).localeCompare(String(b.queuedAt || b.timestamp)));
    if (Array.isArray(ids)) candidates = candidates.filter((ticket) => ids.includes(ticket.id));
    candidates = candidates.slice(0, Math.min(10, Math.max(1, Number(count) || 1)));
    const servingAt = new Date().toISOString();
    candidates.forEach((ticket) => {
      ticket.status = 'Serving';
      ticket.servingAt = servingAt;
      ticket.updatedAt = servingAt;
      cloudWrite('tickets', ticket);
    });
    persist();
    broadcastTickets();
    reply({ ok: true, tickets: candidates });
    if (candidates.length) io.emit('bulkTicketsCalled', { office, tickets: candidates });
  });

  socket.on('adminTransferTicket', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!cloudSyncReady) {
      return reply({ ok: false, error: 'Initial Firestore sync has not completed. Please try again shortly.' });
    }

    const { id, newOffice, purpose, name, studentId } = payload || {};
    const ticket = state.tickets.find((t) => t.id === id);
    const target = String(newOffice || '').toLowerCase();
    const source = ticket?.office;
    if (!ticket) return reply({ ok: false, error: 'Ticket not found.' });
    if (!OFFICES.includes(target)) return reply({ ok: false, error: 'Choose a valid office.' });
    if (target === ticket.office) return reply({ ok: false, error: 'Ticket is already in that office.' });
    const cleanPurpose = String(purpose || '').trim();
    const cleanName = String(name || '').trim();
    if (!cleanPurpose || !cleanName) return reply({ ok: false, error: 'Name and purpose are required.' });

    const dateKey = toDateKey();
    state.counters[target] ||= {};
    state.counters[target][dateKey] = (state.counters[target][dateKey] || 0) + 1;
    const previousNumber = ticket.number;
    ticket.originalNumber ||= previousNumber;
    ticket.previousNumber = previousNumber;
    ticket.previousPurpose = ticket.purpose;
    ticket.number = `${PREFIX[target]}${String(state.counters[target][dateKey]).padStart(3, '0')}`;
    ticket.office = target;
    ticket.purpose = cleanPurpose;
    ticket.name = cleanName;
    ticket.studentId = ticket.clientType === 'student' ? normalizeStudentId(studentId) : 'N/A';
    ticket.status = 'Waiting';
    ticket.isTransferred = true;
    ticket.transferredFrom = source;
    ticket.transferredTo = target;
    ticket.transferredAt = new Date().toISOString();
    ticket.updatedAt = ticket.transferredAt;
    ticket.queuedAt = new Date().toISOString();
    persist();
    broadcastTickets();
    cloudWrite('tickets', ticket);
    cloudWriteCounter(target, dateKey);
    reply({ ok: true, number: ticket.number, previousNumber, office: target });
  });

  socket.on('adminTogglePause', ({ office }) => {
    if (!OFFICES.includes(office)) return;
    state.pauseStates[office] = !state.pauseStates[office];
    persist();
    broadcastSchedules();
  });

  socket.on('adminToggleQueueOpen', ({ office }) => {
    if (!OFFICES.includes(office)) return;
    state.closedStates[office] = !state.closedStates[office];
    persist();
    broadcastSchedules();
  });

  socket.on('notifyClientDevice', (payload) => io.emit('notifyClientDevice', payload));
});

const rootDir = path.join(__dirname, '..');
const distPath = fs.readdirSync(rootDir)
  .map((d) => path.join(rootDir, d, 'dist'))
  .find((p) => fs.existsSync(path.join(p, 'index.html')));
if (distPath) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`LINYA queue engine listening on port ${PORT}`);
});
