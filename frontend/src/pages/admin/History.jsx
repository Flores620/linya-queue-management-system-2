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
  const unclaimed = tickets.filter((t) => t.status === 'Expired').length;
  const transferred = tickets.filter((t) => t.isTransferred).length;
  const rate = total ? Math.round((served / total) * 100) : 0;

  const purposeCount = {};
  tickets.forEach((t) => {
    if (t.purpose) purposeCount[t.purpose] = (purposeCount[t.purpose] || 0) + 1;
  });
  const top = Object.entries(purposeCount).sort((a, b) => b[1] - a[1])[0];

  return { total, served, unclaimed, transferred, rate, topPurpose: top ? top[0] : '—', topCount: top ? top[1] : 0 };
};

const OFFICE_LABELS = {
  registrar: 'Registrar',
  cashier: 'Cashier',
  principal: "Principal's Office",
};

const History = ({ officeType }) => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reportPeriod, setReportPeriod] = useState('daily');
  const [reportValue, setReportValue] = useState(dayKeyOf(new Date()));
  const [isExporting, setIsExporting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState('');
  const [reportError, setReportError] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState({});
  const [expandedDays, setExpandedDays] = useState({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchHistory = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`${LOCAL_SERVER_URL}/api/tickets/history/${officeType}`);
        if (!response.ok) throw new Error(`History request failed (${response.status}).`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('The history response was not in the expected format.');
        if (active) setTickets(data);
      } catch (err) {
        console.error('Failed to load history:', err);
        if (active) setLoadError('History could not be loaded. Check the connection and try again.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchHistory();
    const socket = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });
    socket.on('ticketsUpdated', fetchHistory);
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [officeType, reloadKey]);

  // Group: month -> day, newest first, using real date keys
  const months = useMemo(() => {
    const monthMap = {};
    tickets.forEach((t) => {
      const d = new Date(t.completedAt || t.timestamp);
      if (Number.isNaN(d.getTime())) return;
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
    if (dateFilter) {
      const completedDate = new Date(t.completedAt || t.timestamp);
      if (Number.isNaN(completedDate.getTime()) || dayKeyOf(completedDate) !== dateFilter) return false;
    }
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
  const isFiltering = search.trim() !== '' || dateFilter !== '' || statusFilter !== 'all';
  const hasFilterMatches = months.some((month) =>
    month.dayList.some((day) => day.tickets.some(matchesFilters))
  );
  const officeLabel = OFFICE_LABELS[officeType] || 'Office';

  const updateReportPeriod = (period) => {
    const now = new Date();
    setReportPeriod(period);
    setReportValue(
      period === 'daily'
        ? dayKeyOf(now)
        : period === 'monthly'
          ? monthKeyOf(now)
          : period === 'yearly'
            ? String(now.getFullYear())
            : ''
    );
    setReportFeedback('');
  };

  const downloadReport = async (event) => {
    event.preventDefault();
    setIsExporting(true);
    setReportFeedback('');
    setReportError(false);

    try {
      const query = new URLSearchParams({ period: reportPeriod });
      if (reportPeriod !== 'all') query.set('value', reportValue);
      const response = await fetch(
        `${LOCAL_SERVER_URL}/api/tickets/history/${officeType}/export?${query.toString()}`
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || `Report download failed (${response.status}).`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1]
        || `${officeType}-${reportPeriod}-${reportValue || 'history'}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setReportFeedback(`${filename} is ready.`);
    } catch (error) {
      setReportError(true);
      setReportFeedback(error.message || 'The report could not be downloaded.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="hx-container">
      <header className="hx-header">
        <div>
          <p className="hx-eyebrow">REPORTING · {officeLabel.toUpperCase()}</p>
          <h1 className="hx-title">Service history</h1>
          <p className="hx-subtitle">Completed and unclaimed tickets, grouped by completion date</p>
        </div>
      </header>

      <section className="hx-report-builder" aria-labelledby="hx-report-title">
        <div className="hx-report-intro">
          <span className="hx-report-icon" aria-hidden="true">
            <i className="bi bi-file-earmark-spreadsheet" />
          </span>
          <div>
            <h2 id="hx-report-title">Download a report</h2>
            <p>Choose a reporting period to export this office's history as CSV.</p>
          </div>
        </div>
        <form className="hx-report-form" onSubmit={downloadReport}>
          <label className="hx-report-field">
            <span>Report period</span>
            <select value={reportPeriod} onChange={(e) => updateReportPeriod(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="all">All history</option>
            </select>
          </label>
          {reportPeriod !== 'all' && (
            <label className="hx-report-field">
              <span>{reportPeriod === 'daily' ? 'Report date' : reportPeriod === 'monthly' ? 'Report month' : 'Report year'}</span>
              <input
                type={reportPeriod === 'daily' ? 'date' : reportPeriod === 'monthly' ? 'month' : 'number'}
                min={reportPeriod === 'yearly' ? '1' : undefined}
                max={reportPeriod === 'yearly' ? '9999' : undefined}
                value={reportValue}
                onChange={(e) => setReportValue(e.target.value)}
                required
              />
            </label>
          )}
          <button type="submit" className="hx-export" disabled={isExporting}>
            <i className={`bi ${isExporting ? 'bi-arrow-repeat' : 'bi-download'}`} aria-hidden="true" />
            {isExporting ? 'Preparing report...' : 'Download CSV'}
          </button>
        </form>
        {reportFeedback && (
          <p className={`hx-report-feedback${reportError ? ' error' : ''}`} role={reportError ? 'alert' : 'status'}>
            {reportFeedback}
          </p>
        )}
      </section>

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
          aria-label="Search history"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="date"
          className="hx-date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          aria-label="Filter by completion date"
        />
        <select
          className="hx-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by ticket status"
        >
          <option value="all">All statuses</option>
          <option value="served">Served only</option>
          <option value="unclaimed">Unclaimed only</option>
        </select>
        {isFiltering && (
          <button
            type="button"
            className="hx-clear-filters"
            onClick={() => {
              setSearch('');
              setDateFilter('');
              setStatusFilter('all');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <div className="hx-empty" role="status">Loading service history...</div>}
      {!loading && loadError && (
        <div className="hx-empty hx-error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
        </div>
      )}
      {!loading && !loadError && months.length === 0 && (
        <div className="hx-empty">No service history is available for this office yet.</div>
      )}
      {!loading && !loadError && isFiltering && !hasFilterMatches && (
        <div className="hx-empty">No tickets match your search and status filters.</div>
      )}

      {/* MONTHS */}
      {!loading && !loadError && months.map((month) => {
        const visibleDays = month.dayList
          .map((day) => ({ ...day, visible: day.tickets.filter(matchesFilters) }))
          .filter((day) => (isFiltering ? day.visible.length > 0 : true));

        if (isFiltering && visibleDays.length === 0) return null;
        const monthOpen = isFiltering || expandedMonths[month.key];

        return (
          <section key={month.key} className="hx-month">
            <button
              type="button"
              className="hx-month-header"
              onClick={() => toggleMonth(month.key)}
              aria-expanded={monthOpen}
              aria-controls={`history-month-${month.key}`}
            >
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
              <div className="hx-month-body" id={`history-month-${month.key}`}>
                {visibleDays.map((day) => {
                  const dayOpen = isFiltering || expandedDays[day.key];
                  const s = day.stats;
                  return (
                    <div key={day.key} className="hx-day">
                      <button
                        type="button"
                        className="hx-day-header"
                        onClick={() => toggleDay(day.key)}
                        aria-expanded={dayOpen}
                        aria-controls={`history-day-${day.key}`}
                      >
                        <div className="hx-day-left">
                          <span className={`hx-chevron small ${dayOpen ? 'open' : ''}`}>▶</span>
                          <span className="hx-day-title">{day.label}</span>
                        </div>
                        <span className="hx-day-count">{s.total} tickets</span>
                      </button>

                      {dayOpen && (
                        <div className="hx-day-body" id={`history-day-${day.key}`}>
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
                                  <th>Completed</th>
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
                                        {t.status === 'Expired' ? 'Unclaimed' : t.status}
                                      </span>
                                    </td>
                                    <td>{new Date(t.completedAt || t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
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