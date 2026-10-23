import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get } from '../lib/api';
import type { Permission, Role } from '../lib/domain';

export interface Me {
  user: { id: string; name: string; email: string; must_change_password: boolean };
  tenant: { id: string; slug: string; name: string; role: Role } | null;
  role: Role | null;
  permissions: Permission[];
  tenants: { id: string; slug: string; name: string; role: Role; role_label: string }[];
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<SessionCtx>({ me: null, loading: true, refresh: async () => {}, can: () => false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await get<Me>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);
  const can = useCallback((p: Permission) => !!me?.permissions.includes(p), [me]);
  return <Ctx.Provider value={{ me, loading, refresh, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
