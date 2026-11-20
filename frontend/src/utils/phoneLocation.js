export function requestPhoneLocation() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('Phone GPS requires a secure HTTPS connection. Open the kiosk using its HTTPS address, then allow location access.'));
      return;
    }

    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location access. Try a current version of Chrome or Safari.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        fromPhone: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }),
      (geoError) => {
        const message = geoError.code === geoError.PERMISSION_DENIED
          ? 'Location permission is blocked. Allow location access for this site in your browser settings, then try again.'
          : geoError.code === geoError.POSITION_UNAVAILABLE
            ? 'Your phone could not get a GPS fix. Turn on device location services and try again, preferably near a window or outdoors.'
            : geoError.code === geoError.TIMEOUT
              ? 'Finding your location took too long. Keep location services on and try again.'
              : 'Unable to read your phone location. Check location permissions and try again.';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
  });
}
