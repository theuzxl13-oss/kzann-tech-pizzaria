import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { moneyInput, parseMoney } from '../lib/api';

// ───────── Toasts ─────────
type Toast = { id: number; text: string; kind: 'info' | 'error' | 'ok' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ───────── Sheet (modal / bottom sheet no celular) ─────────
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
  hero,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  hero?: string | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {hero && <div className="sheet-hero" style={{ backgroundImage: `url(${hero})`, margin: '-18px -18px 0' }} />}
          {children}
        </div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted tiny">{hint}</small>}
    </label>
  );
}

/** Campo de valor em reais que trabalha com centavos. */
export function MoneyInput({
  value,
  onChange,
  placeholder = '0,00',
  className = 'input',
  allowEmpty,
}: {
  value: number | null | undefined;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(moneyInput(value));
  useEffect(() => {
    if (parseMoney(text) !== (value ?? null)) setText(moneyInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={className}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const c = parseMoney(e.target.value);
        if (c !== null || allowEmpty) onChange(c);
      }}
    />
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Carregando" />;
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner />
    </div>
  );
}

export function Empty({ icon = '🍕', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <p className="bold" style={{ color: 'var(--text)' }}>
        {title}
      </p>
      {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

/** Carrega dados assíncronos com estado de loading/erro e função de recarga. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Qty({ value, onChange, min = 1 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="qty">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Diminuir">
        −
      </button>
      <span>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(99, value + 1))} aria-label="Aumentar">
        +
      </button>
    </div>
  );
}

/** Aplica a cor da marca da pizzaria como variável CSS. */
export function useBrand(color?: string | null) {
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    root.style.setProperty('--brand', color);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    root.style.setProperty('--brand-ink', lum > 0.65 ? '#17181a' : '#ffffff');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', color);
    return () => {
      root.style.removeProperty('--brand');
      root.style.removeProperty('--brand-ink');
    };
  }, [color]);
}
