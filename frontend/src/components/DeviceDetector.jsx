import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Home from '../pages/Home';

function DeviceDetector() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const isMobileOrTablet = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  useEffect(() => {
    if (location.pathname !== '/') return;

    // Signed-in staff can stay on the home page (View Kiosk)
    if (isAuthenticated) return;

    // Guests on phones/tablets go straight to the ticket kiosk
    if (isMobileOrTablet) {
      navigate('/Selectoffice', { replace: true });
    }
  }, [location.pathname, isMobileOrTablet, isAuthenticated, navigate]);

  return <Home />;
}

export default DeviceDetector;