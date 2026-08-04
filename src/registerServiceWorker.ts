export function registerServiceWorker() {
  // During the live Tailnet prototype we prefer fresh loads over offline caching.
  // Older iOS Safari tabs were hanging onto stale bundles through the service
  // worker, which made fixes look like they had not deployed. Remove any prior
  // worker/caches; we can re-enable an offline shell once the mobile UX settles.
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch((error) => console.warn('Service worker cleanup failed', error));
    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch((error) => console.warn('Cache cleanup failed', error));
    }
  });
}
