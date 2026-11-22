import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import logo from "../../assets/logo.svg";
import PhoneLocationPrompt from "../../components/PhoneLocationPrompt.jsx";
import "../../styles/Purpose.css";

function PrincipalPurpose() {
  const navigate = useNavigate();
  const location = useLocation();
  const office = location.state?.office || "principal";

  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [clientType, setClientType] = useState("student");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name || !purpose || (clientType === "student" && !studentId.trim())) {
      alert("Please fill in all fields.");
      return;
    }
    navigate("/Getticket", {
      state: {
        name,
        studentId: studentId || "N/A",
        purpose,
        office,
        clientType,
      },
    });
  };

  return (
    <div className="purpose-container">
      <div className="purpose-content purpose-form-content">
        <button
          type="button"
          className="purpose-back-button"
          onClick={() => navigate("/kiosk")}
        >
          Back to offices
        </button>
        <img src={logo} alt="Linya Logo" />
        <h3>Principal's Office</h3>
        <PhoneLocationPrompt />

        <form onSubmit={handleSubmit}>
          <fieldset className="client-type-picker">
            <legend>Client type</legend>
            <label className="client-type-option">
              <input type="radio" name="clientType" value="student" checked={clientType === "student"} onChange={() => setClientType("student")} />
              <span className="client-type-icon" aria-hidden="true">S</span>
              <span className="client-type-copy">
                <strong>Student</strong>
              </span>
              <span className="client-type-check" aria-hidden="true">✓</span>
            </label>
            <label className="client-type-option">
              <input type="radio" name="clientType" value="visitor" checked={clientType === "visitor"} onChange={() => setClientType("visitor")} />
              <span className="client-type-icon" aria-hidden="true">V</span>
              <span className="client-type-copy">
                <strong>Visitor</strong>
              </span>
              <span className="client-type-check" aria-hidden="true">✓</span>
            </label>
          </fieldset>

          <div>
            <label>Name:</label>
            <input
              type="text"
              placeholder="Enter name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {clientType === "student" && <div>
            <label>Student ID:</label>
            <input
              type="text"
              placeholder="Enter Student ID"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            />
          </div>}

          <div>
            <label>Purpose:</label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              required
            >
              <option value="">Select Transact</option>
              <option value="Disciplinary Concern / Incident Report">Disciplinary Concern / Incident Report</option>
              <option value="Parent-Teacher Conference Request">Parent-Teacher Conference Request</option>
              <option value="Appeal / Grievance Filing">Appeal / Grievance Filing</option>
              <option value="Scholarship Endorsement">Scholarship Endorsement</option>
              <option value="Excuse Letter / Absence Justification">Excuse Letter / Absence Justification</option>
              <option value="School Policy Inquiry">School Policy Inquiry</option>
              <option value="General Consultation">General Consultation</option>
            </select>
          </div>

          
          <button type="submit">Submit</button>
        </form>
      </div>
    </div>
  );
}

export default PrincipalPurpose;