import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Monitora se o aparelho está online ou offline e exibe um aviso rápido
 * quando a internet volta.
 */
export function useConnectivityStatus(onReconnected?: () => void) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [justReconnected, setJustReconnected] = useState<boolean>(false);

  const wasOfflineRef = useRef<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReconnectedRef = useRef(onReconnected);
  onReconnectedRef.current = onReconnected;

  const dismissReconnectedBanner = useCallback(() => {
    setJustReconnected(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
      setJustReconnected(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };

    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setJustReconnected(true);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          setJustReconnected(false);
        }, 5000);
        onReconnectedRef.current?.();
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  return {
    isOnline,
    justReconnected,
    dismissReconnectedBanner,
  };
}
