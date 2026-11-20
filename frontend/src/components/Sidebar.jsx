import { useNavigate } from 'react-router-dom';

const Sidebar = ({ activeTab, setActiveTab, officeType }) => {
    const navigate = useNavigate();

  return (
    <nav className="nav-sidebar">
      <div className="nav-logo">
        <h3>{officeType.toUpperCase()}</h3>
      </div>
      <ul className="nav-links">
        <li className={activeTab === 'queue' ? 'active' : ''} onClick={() => setActiveTab('queue')}>
          <span className="icon"></span> Queue Management
        </li>
        <li className={activeTab === 'stats' ? 'active' : ''} onClick={() => setActiveTab('stats')}>
          <span className="icon"></span> Stats
        </li>
        <li className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
          <span className="icon"></span> History
        </li>

      </ul>
    </nav>
  );
};

export default Sidebar;