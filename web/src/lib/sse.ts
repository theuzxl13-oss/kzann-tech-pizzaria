import { useEffect, useRef } from 'react';
import { BASE, IS_DEMO } from './api';

type Listener = (type: string, data: any) => void;

/**
 * Assina um stream SSE do servidor. Reconecta automaticamente (EventSource) e
 * dispara "resync" ao reconectar para a tela recarregar os dados.
 */
export function useEventStream(path: string | null, onEvent: Listener) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    if (!path) return;
    if (IS_DEMO) {
      let unsub = () => {};
      import('../demo/server').then((m) => {
        unsub = m.subscribe(path, (t, d) => ref.current(t, d));
      });
      return () => unsub();
    }
    const es = new EventSource(`${BASE}${path}`, { withCredentials: true });
    let opened = false;
    const fire = (type: string) => (e: MessageEvent) => {
      let data: any = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        /* ignora */
      }
      ref.current(type, data);
    };
    ['order.created', 'order.updated', 'order.paid', 'resync'].forEach((t) => es.addEventListener(t, fire(t) as EventListener));
    es.addEventListener('ready', () => {
      if (opened) ref.current('resync', null);
      opened = true;
    });
    return () => es.close();
  }, [path]);
}
