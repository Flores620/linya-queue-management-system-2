const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const PDFDocument = require('pdfkit');

const OFFICES = ['registrar', 'cashier', 'principal'];
const PREFIX = { registrar: 'R-', cashier: 'C-', principal: 'P-' };
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'queue-data.json');
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

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

function defaultState() {
  return {
    tickets: [],
    counters: { registrar: {}, cashier: {}, principal: {} },
    pauseStates: { registrar: false, cashier: false, principal: false },
    closedStates: { registrar: false, cashier: false, principal: false },
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
    };
  } catch (error) {
    console.error('Could not read local queue backup:', error.message);
    return defaultState();
  }
}

let state = loadState();
let lastScheduleKey = '';
let lastRolloverDate = toDateKey();

function persist() {
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function cloudWrite(doc, value) {
  if (firestoreEnabled) db.collection(doc).doc(value.id).set(value).catch((error) =>
    console.log('Cloud backup deferred:', error.message)
  );
}

function cloudWriteCounter(office, dateKey) {
  if (!firestoreEnabled) return;
  db.collection('counters').doc(`${office}_${dateKey}`).set({
    office,
    date: dateKey,
    lastNumber: state.counters[office][dateKey] || 0,
    isPaused: state.pauseStates[office],
    isClosed: state.closedStates[office],
  }, { merge: true }).catch((error) => console.log('Cloud counter backup deferred:', error.message));
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
  io.emit('pauseStateChanged', { ...state.pauseStates });
  io.emit('closedStateChanged', { ...state.closedStates });
  io.emit('officeStatesUpdated', {
    pauseStates: { ...state.pauseStates },
    closedStates: { ...state.closedStates },
  });
}

function applyDailyRollover() {
  const dateKey = toDateKey();
  if (dateKey === lastRolloverDate) return;

  const previousDate = lastRolloverDate;
  let changed = 0;
  state.tickets.forEach((ticket) => {
    if (['Waiting', 'Serving', 'On Hold'].includes(ticket.status)) {
      ticket.status = 'Expired';
      ticket.completedAt = new Date(`${previousDate}T16:00:00`).toISOString();
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
setInterval(() => {
  applyOfficeSchedule();
  applyDailyRollover();
}, 30 * 1000);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: firestoreEnabled ? 'online-with-local-backup' : 'local-only',
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
    .filter((t) => t.office === req.params.office && ['Served', 'Expired'].includes(t.status))
    .sort((a, b) => String(b.completedAt || b.timestamp).localeCompare(String(a.completedAt || a.timestamp)));
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
      if (ticket.office !== req.params.office || !['Served', 'Expired'].includes(ticket.status)) return false;
      if (period === 'all') return true;

      const completedAt = new Date(ticket.completedAt || ticket.timestamp);
      if (Number.isNaN(completedAt.getTime())) return false;
      const dateKey = toDateKey(completedAt);
      if (period === 'daily') return dateKey === reportValue;
      if (period === 'monthly') return dateKey.startsWith(reportValue);
      return dateKey.startsWith(reportValue);
    })
    .sort((a, b) => String(b.completedAt || b.timestamp).localeCompare(String(a.completedAt || a.timestamp)));

  const header = ['Ticket Number', 'Name', 'Client Type', 'Student ID', 'Purpose', 'Status', 'Issued At', 'Completed At'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    header.join(','),
    ...rows.map((t) => [
      t.number, t.name, t.clientType, t.studentId === 'N/A' ? '' : t.studentId, t.purpose, t.status,
      t.timestamp, t.completedAt || '',
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
    ticket.status = status;
    if (['Served', 'Cancelled', 'Expired'].includes(status)) ticket.completedAt = new Date().toISOString();
    persist();
    broadcastTickets();
    cloudWrite('tickets', ticket);
  });

  socket.on('adminCallNext', ({ office }, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
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
    cloudWrite('tickets', ticket);
    persist();
    broadcastTickets();
    reply({ ok: true, ticket });
  });

  socket.on('adminCallBulk', ({ office, ids, count = 10 }, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
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
      cloudWrite('tickets', ticket);
    });
    persist();
    broadcastTickets();
    reply({ ok: true, tickets: candidates });
    if (candidates.length) io.emit('bulkTicketsCalled', { office, tickets: candidates });
  });

  socket.on('adminTransferTicket', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { id, newOffice, purpose, name, studentId } = payload || {};
    const ticket = state.tickets.find((t) => t.id === id);
    const target = String(newOffice || '').toLowerCase();
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
    ticket.transferredFrom = payload.office || ticket.transferredFrom;
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
