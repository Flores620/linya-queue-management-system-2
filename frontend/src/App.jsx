import React from 'react';
import './styles/App.css';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import Login from './pages/admin/Login.jsx';
import Selectoffice from './pages/student/Selectoffice.jsx';
import Getticket from './pages/student/Getticket.jsx';
import Adminlayout from './pages/admin/Adminlayout.jsx';
import RegistrarPurpose from './pages/student/Registrarpurpose.jsx';
import CashierPurpose from './pages/student/Cashierpurpose.jsx';
import PrincipalPurpose from './pages/student/Principalpurpose.jsx';
import Ticketscreen from './pages/student/Ticketscreen.jsx';
import Home from './pages/Home.jsx';
import Display from './pages/Display.jsx';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

const OFFICE_ROUTES = {
  registrar: '/Registrardashboard',
  cashier: '/Cashierdashboard',
  principal: '/Principaldashboard',
};

// A staff account can only open its own office's dashboard
const ProtectedStaffRoute = ({ office, children }) => {
  const { isAuthenticated, selectedOffice } = useAuth();
  if (!isAuthenticated) return <Navigate to="/Login" replace />;
  if (selectedOffice !== office) {
    return <Navigate to={OFFICE_ROUTES[selectedOffice] || '/Login'} replace />;
  }
  return children;
};

// Already signed in? Skip the login page and go to the account's dashboard
const LoginRoute = () => {
  const { isAuthenticated, selectedOffice } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <Login />;
};

const ProtectedHomeRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/Login" replace />;
};

const RootRoute = () => {
  const { isAuthenticated } = useAuth();
  const isPhone = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);

  if (isPhone) return <Navigate to="/kiosk" replace />;
  if (isAuthenticated) return <Home />;
  return <Navigate to="/Login" replace />;
};

function App() {
  const location = useLocation();
  const standaloneView = ['/kiosk', '/Selectoffice', '/Getticket', '/RegistrarPurpose', '/CashierPurpose', '/PrincipalPurpose', '/ticketscreen', '/display'].includes(location.pathname);

  return (
    <AuthProvider>
      {!standaloneView && <Navbar />}
      <main className="app-content-window" style={{ minHeight: '85vh' }}>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/Home" element={<ProtectedHomeRoute><Home /></ProtectedHomeRoute>} />
          <Route path="/ticketscreen" element={<Ticketscreen />} />
          <Route path="/kiosk" element={<Selectoffice />} />
          <Route path="/display" element={<Display />} />
          <Route path="/Selectoffice" element={<Selectoffice />} />
          <Route path="/Getticket" element={<Getticket />} />
          <Route path="/RegistrarPurpose" element={<RegistrarPurpose />} />
          <Route path="/CashierPurpose" element={<CashierPurpose />} />
          <Route path="/PrincipalPurpose" element={<PrincipalPurpose />} />
          <Route path="/admin" element={<Navigate to="/Login" replace />} />
          <Route path="/Login" element={<LoginRoute />} />
          <Route path="/Staffselectoffice" element={<Navigate to="/Login" replace />} />
          <Route path="/Registrardashboard" element={<ProtectedStaffRoute office="registrar"><Adminlayout officeType="registrar" /></ProtectedStaffRoute>} />
          <Route path="/Cashierdashboard" element={<ProtectedStaffRoute office="cashier"><Adminlayout officeType="cashier" /></ProtectedStaffRoute>} />
          <Route path="/Principaldashboard" element={<ProtectedStaffRoute office="principal"><Adminlayout officeType="principal" /></ProtectedStaffRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!standaloneView && <Footer />}
    </AuthProvider>
  );
}

export default App;