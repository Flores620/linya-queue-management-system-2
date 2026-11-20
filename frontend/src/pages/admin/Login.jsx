import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../styles/Login.css';
import logo from '../../assets/logo.svg';
import { useAuth } from '../../context/AuthContext';

const LOCAL_SERVER_URL = import.meta.env.DEV
  ? `http://${window.location.hostname}:5000`
  : window.location.origin;

function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { loginLocalUser } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const response = await fetch(`${LOCAL_SERVER_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) throw new Error('Invalid email or password.');

      const data = await response.json();
      if (!data.user?.office) throw new Error('This account is not linked to an office.');

      loginLocalUser(data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setMsg(err.message === 'Failed to fetch' ? 'Cannot reach the server.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-card">
          <div className="card-logo-container"><img src={logo} alt="LINYA Logo" className="card-logo" /></div>
          <h2 className="card-title">LINYA STAFF</h2>
          <form className="login-form" onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" placeholder="Enter Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div className="password-input-wrapper">
                <input type={showPassword ? 'text' : 'password'} className="form-input" placeholder="Enter Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="toggle-password" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="2"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" strokeWidth="2"/>
                      <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-login" disabled={busy}>{busy ? 'Signing in...' : 'Log In'}</button>
            {msg && <p className="login-message">{msg}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;