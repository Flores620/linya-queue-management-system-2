import { useState } from 'react';
import { requestPhoneLocation } from '../utils/phoneLocation.js';

function PhoneLocationPrompt() {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const [status, setStatus] = useState('');

  if (!isMobile) return null;

  const handleEnableLocation = async () => {
    setStatus('Waiting for your phone location...');
    try {
      await requestPhoneLocation();
      setStatus('Location access is ready. Continue filling out the form.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="phone-location-prompt">
      <p>Allow this site to use your phone location before requesting a ticket.</p>
      <button type="button" onClick={handleEnableLocation}>
        Enable location access
      </button>
      {status && <p role="status">{status}</p>}
    </div>
  );
}

export default PhoneLocationPrompt;
