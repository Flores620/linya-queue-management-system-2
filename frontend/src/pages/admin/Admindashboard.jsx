import React, { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import '../../styles/Dashboard.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

const OFFICE_LABELS = {
  registrar: 'Registrar',
  cashier: 'Cashier',
  principal: "Principal's Office",
};

const STATUS_COLORS = {
  Served: '#15803d',
  Waiting: '#d97706',
  Serving: '#2563eb',
  'On hold': '#7c3aed',
  Other: '#94a3b8',
};

const getDayKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const OFFICE_PREFIXES = {
  registrar: 'R-',
  cashier: 'C-',
  principal: 'P-',
};

const getTransferSource = (ticket) => {
  if (ticket.transferredFrom) return ticket.transferredFrom;
  const originalNumber = ticket.originalNumber || ticket.previousNumber || '';
  return Object.keys(OFFICE_PREFIXES).find((office) => originalNumber.startsWith(OFFICE_PREFIXES[office]));
};

const belongsToOfficeStats = (ticket, officeType) =>
  ticket.office === officeType || (ticket.isTransferred && getTransferSource(ticket) === officeType);

const getOfficeTicketStatus = (ticket, officeType) =>
  ticket.isTransferred && getTransferSource(ticket) === officeType ? 'Served' : ticket.status;

const getOfficeActivityDate = (ticket) =>
  new Date(ticket.isTransferred ? ticket.transferredAt || ticket.timestamp : ticket.timestamp);

const DashboardStats = ({ officeType }) => {
  const [tickets, setTickets] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('ticketsUpdated', (allTickets) => {
      setTickets(allTickets.filter((ticket) => belongsToOfficeStats(ticket, officeType)));
    });

    return () => socket.disconnect();
  }, [officeType]);

  const todayKey = getDayKey(new Date());
  const todayTickets = useMemo(
    () => tickets.filter((ticket) => {
      const date = getOfficeActivityDate(ticket);
      return !Number.isNaN(date.getTime()) && getDayKey(date) === todayKey;
    }),
    [tickets, todayKey]
  );

  const stats = useMemo(() => ({
    issuedToday: todayTickets.length,
    servedToday: todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Served').length,
    waitingNow: tickets.filter((ticket) => ticket.office === officeType && ticket.status === 'Waiting').length,
    servingNow: tickets.filter((ticket) => ticket.office === officeType && ticket.status === 'Serving').length,
    completionRate: todayTickets.length
      ? Math.round((todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Served').length / todayTickets.length) * 100)
      : 0,
  }), [tickets, todayTickets, officeType]);

  const weeklyData = useMemo(() => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - 6);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const key = getDayKey(date);
      const dayTickets = tickets.filter((ticket) => {
        const timestamp = getOfficeActivityDate(ticket);
        return !Number.isNaN(timestamp.getTime()) && getDayKey(timestamp) === key;
      });

      return {
        day: date.toLocaleDateString(undefined, { weekday: 'short' }),
        issued: dayTickets.length,
        served: dayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Served').length,
      };
    });
  }, [tickets, officeType]);

  const statusData = useMemo(() => {
    const counts = [
      ['Served', todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Served').length],
      ['Waiting', todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Waiting').length],
      ['Serving', todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Serving').length],
      ['On hold', todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'On Hold').length],
      ['Other', todayTickets.filter((ticket) => getOfficeTicketStatus(ticket, officeType) === 'Expired').length],
    ];
    return counts
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [todayTickets, officeType]);

  const officeLabel = OFFICE_LABELS[officeType] || 'Office';
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="stats-page">
      <header className="stats-header">
        <div>
          <p className="stats-eyebrow">OFFICE OVERVIEW</p>
          <h1>{officeLabel} statistics</h1>
          <p className="stats-subtitle">Service performance and queue activity</p>
        </div>
        <div className="stats-header-meta">
          <span className={`stats-live${isConnected ? ' connected' : ''}`}>
            <span aria-hidden="true" />
            {isConnected ? 'Live updates' : 'Reconnecting'}
          </span>
          <time>{todayLabel}</time>
        </div>
      </header>

      <section className="stats-grid" aria-label="Today's key metrics">
        <article className="stats-kpi stats-kpi-blue">
          <span className="stats-kpi-label">Tickets issued today</span>
          <strong>{stats.issuedToday}</strong>
          <span className="stats-kpi-note">All ticket statuses</span>
        </article>
        <article className="stats-kpi stats-kpi-green">
          <span className="stats-kpi-label">Served today</span>
          <strong>{stats.servedToday}</strong>
          <span className="stats-kpi-note">Completed transactions</span>
        </article>
        <article className="stats-kpi stats-kpi-amber">
          <span className="stats-kpi-label">Waiting now</span>
          <strong>{stats.waitingNow}</strong>
          <span className="stats-kpi-note">Currently in the queue</span>
        </article>
        <article className="stats-kpi stats-kpi-violet">
          <span className="stats-kpi-label">Completion today</span>
          <strong>{stats.completionRate}%</strong>
          <span className="stats-kpi-note">{stats.servingNow} currently being served</span>
        </article>
      </section>

      <section className="stats-charts" aria-label="Queue performance charts">
        <article className="stats-panel">
          <header className="stats-panel-header">
            <div>
              <h2>Daily volume</h2>
              <p>Tickets issued and served over the last seven days</p>
            </div>
          </header>
          {weeklyData.some((day) => day.issued > 0) ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e8edf4" vertical={false} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="issued" name="Issued" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="served" name="Served" fill="#15803d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="stats-chart-empty">No tickets have been issued in the last seven days.</div>
          )}
        </article>

        <article className="stats-panel">
          <header className="stats-panel-header">
            <div>
              <h2>Today's status</h2>
              <p>Current outcome breakdown for tickets issued today</p>
            </div>
          </header>
          {statusData.length > 0 ? (
            <div className="stats-chart stats-donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={3}
                  >
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="stats-chart-empty">Today's status breakdown will appear when tickets are issued.</div>
          )}
        </article>
      </section>
    </div>
  );
};

export default DashboardStats;
