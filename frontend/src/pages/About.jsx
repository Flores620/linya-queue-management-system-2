import '../styles/About.css';

export default function About() {
  return (
    <div className="about-container">
      <div className="about-content">
        <h2>About Linya Queue Management</h2>
        <p className="lead">Linya is designed to streamline the campus experience by reducing physical wait times...</p>
        
        <div className="mission-box">
          <p>Our mission is to provide a seamless bridge between students and administrative offices...</p>
        </div>

        <div className="steps-grid">
          <div className="step-card"><span>1</span><p>Get a ticket</p></div>
          <div className="step-card"><span>2</span><p>Watch the monitor</p></div>
          <div className="step-card"><span>3</span><p>Get served!</p></div>
        </div>

        <p className="footer-note">No more standing in long lines under the sun or in crowded hallways...</p>
      </div>
    </div>
  )
}