import React, { useState } from 'react';
import Sidebar from '../../components/Sidebar';
import AdminManagement from './Adminmanagement';
import DashboardStats from './Admindashboard';
import History from './History';
import '../../styles/Dashboard.css';

const AdminLayout = ({ officeType }) => {
  const [activeTab, setActiveTab] = useState('queue');

  const renderContent = () => {
    switch (activeTab) {
      case 'queue': return <AdminManagement officeType={officeType} />;
      case 'stats': return <DashboardStats officeType={officeType} />;
      case 'history': return <History officeType={officeType} />;
      default: return <AdminManagement officeType={officeType} />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        officeType={officeType} 
      />
      <main className="content-window">
        {renderContent()}
      </main>
    </div>
  );
};

export default AdminLayout;