import React from 'react';
import '../styles/Receipt.css';

function Queuecard({ ticket }) {

  return (
    <div className="receipt-container">
      <div className="receipt">

        <div className="center">
          <h2>LINYA SYSTEM</h2>
          <p>Queue Ticket</p>
        </div>

        <div className="hr"></div>

        <p className="center">TICKET NO</p>
        <div className="ticket-number">{ticket.number}</div>

        <div className="hr"></div>

        <p><strong>Name:</strong> {ticket.name}</p>
        <p><strong>Student ID:</strong> {ticket.studentId}</p>
        <p><strong>Office:</strong> {ticket.office}</p>
        <p><strong>Purpose:</strong> {ticket.purpose}</p>
        

        <div className="hr"></div>

        <p className="center">Please wait for your turn</p>

        <div className="hr"></div>

        <p className="center small">
          {new Date().toLocaleString()}
        </p>

      </div>
    </div>
  );
}

export default Queuecard;