import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const AuthContext = createContext(null);
const STORAGE_KEY = 'linya_staff_user';

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [highlightedTicketId, setHighlightedTicketId] = useState(null);

  const loginLocalUser = useCallback((account) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    setUser(account);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setHighlightedTicketId(null);
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    selectedOffice: user?.office || null, // the office is fixed by the account
    loginLocalUser,
    logout,
    highlightedTicketId,
    setHighlightedTicketId,
  }), [user, loginLocalUser, logout, highlightedTicketId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;