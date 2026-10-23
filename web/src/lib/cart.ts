import { useSyncExternalStore } from 'react';
import type { CartItemInput } from '../../../server/src/domain/pricing';

export type { CartItemInput };

export interface CartLine {
  key: string;
  input: CartItemInput;
  name: string;
  description: string;
  unit_price_cents: number; // estimativa exibida; o servidor recalcula no checkout
}

const listeners = new Set<() => void>();
const cache = new Map<string, CartLine[]>();
const storageKey = (slug: string) => `kz_cart_${slug}`;

function read(slug: string): CartLine[] {
  if (!cache.has(slug)) {
    let lines: CartLine[] = [];
    try {
      lines = JSON.parse(localStorage.getItem(storageKey(slug)) ?? '[]');
    } catch {
      lines = [];
    }
    cache.set(slug, Array.isArray(lines) ? lines : []);
  }
  return cache.get(slug)!;
}

function write(slug: string, lines: CartLine[]) {
  cache.set(slug, lines);
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(lines));
  } catch {
    /* armazenamento indisponível: carrinho fica só em memória */
  }
  listeners.forEach((l) => l());
}

export const cart = {
  add(slug: string, line: Omit<CartLine, 'key'>) {
    write(slug, [...read(slug), { ...line, key: crypto.randomUUID?.() ?? String(Date.now() + Math.random()) }]);
  },
  setQuantity(slug: string, key: string, quantity: number) {
    write(
      slug,
      read(slug)
        .map((l) => (l.key === key ? { ...l, input: { ...l.input, quantity } } : l))
        .filter((l) => l.input.quantity > 0),
    );
  },
  remove(slug: string, key: string) {
    write(slug, read(slug).filter((l) => l.key !== key));
  },
  clear(slug: string) {
    write(slug, []);
  },
};

export function useCart(slug: string) {
  const lines = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(slug),
  );
  const count = lines.reduce((s, l) => s + l.input.quantity, 0);
  const total = lines.reduce((s, l) => s + l.unit_price_cents * l.input.quantity, 0);
  return { lines, count, total };
}

// Pedidos recentes deste aparelho (para o cliente reabrir o acompanhamento).
export interface RecentOrder {
  token: string;
  number: number;
  created_at: string;
}

export function rememberOrder(slug: string, o: RecentOrder) {
  try {
    const key = `kz_orders_${slug}`;
    const list: RecentOrder[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    localStorage.setItem(key, JSON.stringify([o, ...list.filter((x) => x.token !== o.token)].slice(0, 10)));
  } catch {
    /* ignora */
  }
}

export function recentOrders(slug: string): RecentOrder[] {
  try {
    return JSON.parse(localStorage.getItem(`kz_orders_${slug}`) ?? '[]');
  } catch {
    return [];
  }
}

/** Dados do cliente salvos no aparelho para agilizar o próximo pedido. */
export function loadCustomer(): any {
  try {
    return JSON.parse(localStorage.getItem('kz_customer') ?? 'null');
  } catch {
    return null;
  }
}
export function saveCustomer(data: unknown) {
  try {
    localStorage.setItem('kz_customer', JSON.stringify(data));
  } catch {
    /* ignora */
  }
}
