export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
let demoHandler: Promise<Handler> | null = null;

/** Chamada à API. Envia o cabeçalho anti-CSRF exigido pelo servidor em rotas privadas. */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (IS_DEMO) {
    demoHandler ??= import('../demo/server').then((m) => m.handle);
    const res = await (await demoHandler)(method, path, body);
    if (res.status >= 400) throw new ApiError(res.status, res.body?.error?.code ?? 'error', res.body?.error?.message ?? 'Erro');
    return res.body as T;
  }
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-kzann-csrf': '1',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão. Verifique sua internet e tente novamente.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Erro ${res.status}`);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

// ───────── Formatação ─────────

export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "54,90" → 5490 */
export function parseMoney(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const moneyInput = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');

export function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Link wa.me (número brasileiro recebe DDI 55). */
export function whatsappLink(phone: string, text: string): string {
  let d = phone.replace(/\D/g, '');
  if (d && d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export const dateTime = (v: string | Date) =>
  new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const time = (v: string | Date) => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function minutesSince(v: string | Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000));
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function absoluteUrl(path: string): string {
  return `${location.origin}${BASE}${path}`;
}
