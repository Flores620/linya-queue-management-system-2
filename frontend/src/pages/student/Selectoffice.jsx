import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../styles/Selectoffice.css'

function Selectoffice() {
  const navigate = useNavigate();
  const [selectedOffice, setSelectedOffice] = useState("");

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
    const route = selectedOffice === "registrar" ? "/RegistrarPurpose" : selectedOffice === "cashier" ? "/CashierPurpose" : "/PrincipalPurpose";
    navigate(route, {
      state: { office: selectedOffice },
    });
  };

  return (
    <div className="selectoffice-container">
      <h1 className="selectoffice-title">Select Office</h1>
      <div className="office-cards-container">
        {offices.map((office) => (
          <div
            key={office.id}
            className={`office-card ${
              selectedOffice === office.id ? "selected" : ""
            }`}
            onClick={() => setSelectedOffice(office.id)}>
            <div className="office-icon">{office.icon}</div>
            <h3 className="office-name">{office.name}</h3>
            <p className="office-description">{office.description}</p>
          </div>
        ))}
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