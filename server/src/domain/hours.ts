export interface OpeningInterval {
  weekday: number; // 0 = domingo
  opens: string; // HH:MM[:SS]
  closes: string; // HH:MM[:SS]; menor que opens = vira a madrugada
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Dia da semana e minutos do dia no fuso do estabelecimento. */
export function localClock(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Verifica se está aberto agora, considerando expedientes que atravessam a meia-noite. */
export function isOpenAt(hours: OpeningInterval[], timeZone: string, now = new Date()): boolean {
  const { weekday, minutes } = localClock(now, timeZone);
  const yesterday = (weekday + 6) % 7;
  return hours.some((h) => {
    const o = toMinutes(h.opens);
    const c = toMinutes(h.closes);
    if (o === c) return h.weekday === weekday; // 24h
    if (c > o) return h.weekday === weekday && minutes >= o && minutes < c;
    // atravessa a meia-noite
    if (h.weekday === weekday && minutes >= o) return true;
    if (h.weekday === yesterday && minutes < c) return true;
    return false;
  });
}

export function resolveOpenStatus(
  manual: 'auto' | 'open' | 'closed',
  hours: OpeningInterval[],
  timeZone: string,
  now = new Date(),
): boolean {
  if (manual === 'open') return true;
  if (manual === 'closed') return false;
  return isOpenAt(hours, timeZone, now);
}
