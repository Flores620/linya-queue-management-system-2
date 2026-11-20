import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;
const DashboardStats = ({ officeType }) => {
  const [stats, setStats] = useState({ totalServed: 0, currentlyWaiting: 0, totalTicketsToday: 0 });

  useEffect(() => {
    const socket = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });

    socket.on('ticketsUpdated', (allTickets) => {
      const officeTickets = allTickets.filter(t => t.office === officeType);
      const served = officeTickets.filter(t => t.status === 'Served').length;
      const waiting = officeTickets.filter(t => t.status === 'Waiting').length;

      setStats({
        totalServed: served,
        currentlyWaiting: waiting,
        totalTicketsToday: officeTickets.length
      });
    });

    return () => socket.disconnect();
  }, [officeType]);

  const pieData = [
    { name: 'Served', value: stats.totalServed, color: '#4CAF50' },
    { name: 'Waiting', value: stats.currentlyWaiting, color: '#FF9800' }
  ];

  const barData = [
    { name: 'Stats', 
      Served: stats.totalServed, 
      Waiting: stats.currentlyWaiting, 
      Total: stats.totalTicketsToday }
  ];

  return (
    <div className="stats-container">
      <header className="section-header">Office Performance Dashboard</header>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info">
            <h3>Total Served</h3>
            <p className="stat-number">{stats.totalServed}</p>
          </div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-info">
            <h3>Current Queue</h3>
            <p className="stat-number">{stats.currentlyWaiting}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>Total Tickets</h3>
            <p className="stat-number">{stats.totalTicketsToday}</p>
          </div>
        </div>
      </div>
      <div className="charts-section" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '30px' }}>
        <div className="chart-wrapper" style={{ flex: 1, minWidth: '300px', background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <h4 className="text-center mb-3">Status Distribution</h4>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-wrapper" style={{ flex: 1, minWidth: '300px', background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <h4 className="text-center mb-3">Service Comparison</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData}>
              <XAxis dataKey="name" hide /><YAxis /><Tooltip /><Legend />
              <Bar dataKey="Served" fill="#4CAF50" radius={[5, 5, 0, 0]} />
              <Bar dataKey="Waiting" fill="#FF9800" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default DashboardStats;
