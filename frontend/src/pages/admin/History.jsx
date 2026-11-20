import React, { useState, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

const pad = (n) => String(n).padStart(2, '0');
const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dayKeyOf = (d) => `${monthKeyOf(d)}-${pad(d.getDate())}`;

const computeStats = (tickets) => {
  const total = tickets.length;
  const served = tickets.filter((t) => t.status === 'Served').length;
  const unclaimed = total - served;
  const transferred = tickets.filter((t) => t.isTransferred).length;
  const rate = total ? Math.round((served / total) * 100) : 0;

  const purposeCount = {};
  tickets.forEach((t) => {
    if (t.purpose) purposeCount[t.purpose] = (purposeCount[t.purpose] || 0) + 1;
  });
  const top = Object.entries(purposeCount).sort((a, b) => b[1] - a[1])[0];

  return { total, served, unclaimed, transferred, rate, topPurpose: top ? top[0] : '—', topCount: top ? top[1] : 0 };
};

const History = ({ officeType }) => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedMonths, setExpandedMonths] = useState({});
  const [expandedDays, setExpandedDays] = useState({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const fetchHistory = () => {
      fetch(`${LOCAL_SERVER_URL}/api/tickets/history/${officeType}`)
        .then((res) => res.json())
        .then((data) => {
          setTickets(Array.isArray(data) ? data : []);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load history:', err);
          setLoading(false);
        });
    };

    fetchHistory();
    const socket = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });
    socket.on('ticketsUpdated', fetchHistory);
    return () => socket.disconnect();
  }, [officeType]);

  // Group: month -> day, newest first, using real date keys
  const months = useMemo(() => {
    const monthMap = {};
    tickets.forEach((t) => {
      const d = new Date(t.timestamp);
      if (isNaN(d)) return;
      const mk = monthKeyOf(d);
      const dk = dayKeyOf(d);
      if (!monthMap[mk]) {
        monthMap[mk] = {
          key: mk,
          label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
          days: {},
          all: [],
        };
      }
      if (!monthMap[mk].days[dk]) {
        monthMap[mk].days[dk] = {
          key: dk,
          date: d,
          label: d.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
          tickets: [],
        };
      }
      monthMap[mk].days[dk].tickets.push(t);
      monthMap[mk].all.push(t);
    });

    return Object.values(monthMap)
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .map((m) => ({
        ...m,
        stats: computeStats(m.all),
        dayList: Object.values(m.days)
          .sort((a, b) => (a.key < b.key ? 1 : -1))
          .map((day) => ({
            ...day,
            tickets: [...day.tickets].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
            stats: computeStats(day.tickets),
          })),
      }));
  }, [tickets]);

  // Open the newest month and day the first time data arrives
  useEffect(() => {
    if (!initialized && months.length > 0) {
      setExpandedMonths({ [months[0].key]: true });
      if (months[0].dayList[0]) setExpandedDays({ [months[0].dayList[0].key]: true });
      setInitialized(true);
    }
  }, [months, initialized]);

  const overall = useMemo(() => computeStats(tickets), [tickets]);

  const matchesFilters = (t) => {
    if (statusFilter === 'served' && t.status !== 'Served') return false;
    if (statusFilter === 'unclaimed' && t.status !== 'Expired') return false;
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      t.name?.toLowerCase().includes(term) ||
      t.purpose?.toLowerCase().includes(term) ||
      t.number?.toString().toLowerCase().includes(term) ||
      t.studentId?.toString().toLowerCase().includes(term)
    );
  };

  const toggleMonth = (key) => setExpandedMonths((p) => ({ ...p, [key]: !p[key] }));
  const toggleDay = (key) => setExpandedDays((p) => ({ ...p, [key]: !p[key] }));
  const isFiltering = search.trim() !== '' || statusFilter !== 'all';
  const downloadCsv = () => {
    window.location.assign(`${LOCAL_SERVER_URL}/api/tickets/history/${officeType}/export`);
  };

  return (
    <div className="hx-container">
      <header className="hx-header">
        <div>
          <h2 className="hx-title">Service History</h2>
          <p className="hx-subtitle">Archive of completed and unclaimed tickets, organized by date</p>
        </div>
        <button type="button" className="hx-export" onClick={downloadCsv}>Download CSV Report</button>
      </header>

      {/* ALL-TIME SUMMARY */}
      <div className="hx-summary">
        <div className="hx-summary-card">
          <span className="hx-summary-label">Total Tickets</span>
          <span className="hx-summary-value">{overall.total}</span>
        </div>
        <div className="hx-summary-card hx-green">
          <span className="hx-summary-label">Served</span>
          <span className="hx-summary-value">{overall.served}</span>
        </div>
        <div className="hx-summary-card hx-gray">
          <span className="hx-summary-label">Unclaimed</span>
          <span className="hx-summary-value">{overall.unclaimed}</span>
        </div>
        <div className="hx-summary-card hx-blue">
          <span className="hx-summary-label">Completion Rate</span>
          <span className="hx-summary-value">{overall.rate}%</span>
        </div>
      </div>

      {/* FILTERS */}
      <div className="hx-toolbar">
        <input
          type="text"
          className="hx-search"
          placeholder="Search name, ticket #, student ID, or purpose..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="hx-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="served">Served only</option>
          <option value="unclaimed">Unclaimed only</option>
        </select>
      </div>

      {loading && <div className="hx-empty">Loading history...</div>}
      {!loading && months.length === 0 && (
        <div className="hx-empty">No history yet. Completed tickets will appear here after each day.</div>
      )}

      {/* MONTHS */}
      {months.map((month) => {
        const visibleDays = month.dayList
          .map((day) => ({ ...day, visible: day.tickets.filter(matchesFilters) }))
          .filter((day) => (isFiltering ? day.visible.length > 0 : true));

        if (isFiltering && visibleDays.length === 0) return null;
        const monthOpen = isFiltering || expandedMonths[month.key];

        return (
          <section key={month.key} className="hx-month">
            <button className="hx-month-header" onClick={() => toggleMonth(month.key)}>
              <div className="hx-month-left">
                <span className={`hx-chevron ${monthOpen ? 'open' : ''}`}>▶</span>
                <h3>{month.label}</h3>
              </div>
              <div className="hx-month-chips">
                <span className="hx-chip">{month.stats.total} tickets</span>
                <span className="hx-chip hx-chip-green">{month.stats.served} served</span>
                <span className="hx-chip hx-chip-gray">{month.stats.unclaimed} unclaimed</span>
                <span className="hx-chip hx-chip-blue">{month.stats.rate}%</span>
              </div>
            </button>

            {monthOpen && (
              <div className="hx-month-body">
                {visibleDays.map((day) => {
                  const dayOpen = isFiltering || expandedDays[day.key];
                  const s = day.stats;
                  return (
                    <div key={day.key} className="hx-day">
                      <button className="hx-day-header" onClick={() => toggleDay(day.key)}>
                        <div className="hx-day-left">
                          <span className={`hx-chevron small ${dayOpen ? 'open' : ''}`}>▶</span>
                          <span className="hx-day-title">{day.label}</span>
                        </div>
                        <span className="hx-day-count">{s.total} tickets</span>
                      </button>

                      {dayOpen && (
                        <div className="hx-day-body">
                          {/* DAY STATS */}
                          <div className="hx-day-stats">
                            <div className="hx-stat">
                              <span className="hx-stat-label">Served</span>
                              <span className="hx-stat-value hx-text-green">{s.served}</span>
                            </div>
                            <div className="hx-stat">
                              <span className="hx-stat-label">Unclaimed</span>
                              <span className="hx-stat-value hx-text-gray">{s.unclaimed}</span>
                            </div>
                            <div className="hx-stat">
                              <span className="hx-stat-label">Completion</span>
                              <span className="hx-stat-value hx-text-blue">{s.rate}%</span>
                            </div>
                            <div className="hx-stat">
                              <span className="hx-stat-label">Transferred</span>
                              <span className="hx-stat-value">{s.transferred}</span>
                            </div>
                            <div className="hx-stat hx-stat-wide">
                              <span className="hx-stat-label">Busiest Service</span>
                              <span className="hx-stat-value hx-stat-text" title={s.topPurpose}>
                                {s.topPurpose}{s.topCount ? ` (${s.topCount})` : ''}
                              </span>
                            </div>
                          </div>

                          <div className="hx-progress" title={`${s.rate}% served`}>
                            <div className="hx-progress-served" style={{ width: `${s.rate}%` }} />
                          </div>

                          {/* TICKET TABLE */}
                          <div className="hx-table-wrap">
                            <table className="hx-table">
                              <thead>
                                <tr>
                                  <th>Ticket #</th>
                                  <th>Name</th>
                                  <th>Student ID</th>
                                  <th>Purpose</th>
                                  <th>Status</th>
                                  <th>Time</th>
                                </tr>
                              </thead>
                              <tbody>
                                {day.visible.map((t) => (
                                  <tr key={t.id}>
                                    <td>
                                      <strong>{t.number}</strong>
                                      {t.isTransferred && <span className="hx-tag hx-tag-blue">TRANSFERRED</span>}
                                    </td>
                                    <td>{t.name}</td>
                                    <td>{t.studentId || 'N/A'}</td>
                                    <td>{t.purpose}</td>
                                    <td>
                                      <span className={`hx-status ${t.status === 'Served' ? 'served' : 'unclaimed'}`}>
                                        {t.status === 'Served' ? 'Served' : 'Unclaimed'}
                                      </span>
                                    </td>
                                    <td>{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default History;