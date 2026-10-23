import { useEffect, useRef } from 'react';
import { BASE, IS_DEMO } from './api';

type Listener = (type: string, data: any) => void;

/** O servidor envia "ping" a cada 25 s; sem nenhuma mensagem por este tempo, a conexão é considerada morta. */
const STALE_MS = 60_000;
const RETRY_MS = 3_000;

/**
 * Assina um stream SSE do servidor, com vigilância de conexão:
 * - reconecta se o EventSource fechar (ex.: proxy respondeu 502 durante um deploy);
 * - reconecta se ficar STALE_MS sem nenhuma mensagem (conexão "meio aberta" após o servidor reiniciar);
 * - dispara "resync" a cada reconexão para a tela recarregar os dados perdidos.
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

    let es: EventSource | null = null;
    let opened = false;
    let lastMessage = Date.now();
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const fire = (type: string) => (e: MessageEvent) => {
      lastMessage = Date.now();
      let data: any = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        /* ignora */
      }
      ref.current(type, data);
    };

    const connect = () => {
      if (disposed) return;
      es?.close();
      lastMessage = Date.now();
      es = new EventSource(`${BASE}${path}`, { withCredentials: true });
      ['order.created', 'order.updated', 'order.paid', 'resync'].forEach((t) => es!.addEventListener(t, fire(t) as EventListener));
      es.addEventListener('ping', () => {
        lastMessage = Date.now();
      });
      es.addEventListener('ready', () => {
        lastMessage = Date.now();
        if (opened) ref.current('resync', null);
        opened = true;
      });
      es.onerror = () => {
        // EventSource não tenta de novo após respostas não-200: reconectamos manualmente.
        if (es?.readyState === EventSource.CLOSED) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (retry || disposed) return;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, RETRY_MS);
    };

    const watchdog = setInterval(() => {
      if (Date.now() - lastMessage > STALE_MS) connect();
    }, 10_000);

    // Ao voltar para a aba (celular desbloqueado, por exemplo), confere a conexão na hora.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessage > STALE_MS) connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    connect();
    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      es?.close();
    };
  }, [path]);
}
