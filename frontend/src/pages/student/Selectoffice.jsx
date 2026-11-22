import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import '../../styles/Selectoffice.css'

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

function Selectoffice() {
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const [selectedOffice, setSelectedOffice] = useState("");
  const [pauseStates, setPauseStates] = useState({});
  const [closedStates, setClosedStates] = useState({});

  useEffect(() => {
    socketRef.current = io(LOCAL_SERVER_URL, { transports: ['polling', 'websocket'] });
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

  const offices = [
    {
      id: "registrar",
      name: "Registrar",
      description: "Enrollment, grades, and student records",
      icon: "👤"
    },
    {
      id: "cashier",
      name: "Cashier",
      description: "Payment and financial transactions",
      icon: "₱"
    },
    {
      id: "principal",
      name: "Principal",
      description: "General consultations and disciplinary matters",
      icon: "🏛"
    }
  ];

  const handleProceed = () => {
    if (!selectedOffice) {
      alert("Please select an office.");
      return;
    }
    if (closedStates[selectedOffice] || pauseStates[selectedOffice]) {
      alert("This office is unavailable right now.");
      return;
    }
    const route = selectedOffice === "registrar" ? "/RegistrarPurpose" : selectedOffice === "cashier" ? "/CashierPurpose" : "/PrincipalPurpose";
    navigate(route, {
      state: { office: selectedOffice },
    });
  };

  return (
    <div className="selectoffice-container">
      <h1 className="selectoffice-title">Select Office</h1>
      <div className="office-cards-container">
        {offices.map((office) => {
          const isClosed = !!closedStates[office.id];
          const isPaused = !!pauseStates[office.id];
          const status = isClosed ? "Closed" : isPaused ? "Break" : "Open";
          const unavailable = isClosed || isPaused;

          return (
            <button
              type="button"
              key={office.id}
              className={`office-card ${
                selectedOffice === office.id ? "selected" : ""
              } ${unavailable ? "unavailable" : ""}`}
              aria-pressed={selectedOffice === office.id}
              onClick={() => !unavailable && setSelectedOffice(office.id)}>
              <span className={`office-status ${status.toLowerCase()}`}>{status}</span>
              <div className="office-icon" aria-hidden="true">{office.icon}</div>
              <h3 className="office-name">{office.name}</h3>
              <p className="office-description">{office.description}</p>
            </button>
          );
        })}
      </div>
      <button
        className="btn-proceed"
        onClick={handleProceed}>
        Proceed
      </button>
    </div>
  )
}

export default Selectoffice