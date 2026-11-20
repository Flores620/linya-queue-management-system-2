import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { io } from 'socket.io-client';
import '../../styles/Selectoffice.css';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

function Staffselectoffice() {
  const navigate = useNavigate();
  const { selectOffice } = useAuth();
  const [selectedOffice, setSelectedOffice] = useState("");
  const [queueCounts, setQueueCounts] = useState({ registrar: 0, cashier: 0, principal: 0 });

  useEffect(() => {
    const socket = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });

    socket.on('ticketsUpdated', (allTickets) => {
      const registrarCount = allTickets.filter(t => t.office === 'registrar' && t.status === 'Waiting').length;
      const cashierCount = allTickets.filter(t => t.office === 'cashier' && t.status === 'Waiting').length;
      const principalCount = allTickets.filter(t => t.office === 'principal' && t.status === 'Waiting').length;
      setQueueCounts({ registrar: registrarCount, cashier: cashierCount, principal: principalCount });
    });

    return () => socket.disconnect();
  }, []);

  const handleProceed = () => {
    if (!selectedOffice) return alert("Please select an office.");
    selectOffice(selectedOffice);
    navigate(selectedOffice === "registrar" ? "/Registrardashboard" : selectedOffice === "cashier" ? "/Cashierdashboard" : "/Principaldashboard");
  };

  return (
    <div className="selectoffice-container">
      <h1 className="selectoffice-title">Select Office</h1>
      <div className="office-cards-container">
        {[
          { id: "registrar", name: "Registrar", description: "Enrollment, grades, and records", icon: "👤" },
          { id: "cashier", name: "Cashier", description: "Payment and financial transactions", icon: "₱" },
          { id: "principal", name: "Principal", description: "General consultations and disciplinary matters", icon: "🏛" }
        ].map((office) => (
          <div key={office.id} className={`office-card ${selectedOffice === office.id ? "selected" : ""}`} onClick={() => setSelectedOffice(office.id)}>
            <div className="office-icon">{office.icon}</div>
            <h3 className="office-name">{office.name}</h3>
            <p className="office-description">{office.description}</p>
            <p className="queue-count">Queue: {queueCounts[office.id]}</p>
          </div>
        ))}
      </div>
      <button className="btn-proceed" onClick={handleProceed}>Proceed</button>
    </div>
  );
}

export default Staffselectoffice;
