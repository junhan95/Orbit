import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
const getSnapshot = () => window.matchMedia(query).matches;
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
