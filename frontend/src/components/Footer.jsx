import React from 'react'
import '../styles/Footer.css'

function Footer() {

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };
  return (
    <footer className="home-footer-bottom">
  <div className="footer-content">
    <div className="footer-brand">
      <span className="footer-logo">LINYA</span>
      <p>------</p>
    </div>
    
    <div className="footer-links">
      <div className="link-group">
        <h4>Navigation</h4>
        <button onClick={() => scrollToSection('tutorial')}>Tutorial</button>
        <button onClick={() => scrollToSection('getticket')}>Get Ticket</button>
        <button onClick={() => scrollToSection('about')}>About Us</button>
      </div>
      <div className="link-group">
        <h4>Support</h4>
        <a href="mailto:support@linya.edu">Help Center</a>
        <a href="/terms">Terms of Service</a>
      </div>
    </div>
  </div>
  
  <div className="footer-copyright">
    <p>&copy; {new Date().getFullYear()} LINYA Management System. All rights reserved.</p>
  </div>
</footer>
)
}

export default Footer