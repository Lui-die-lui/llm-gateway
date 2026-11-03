// Settings that belong to this browser's console session only (not to the gateway). The idle logout is enforced right here by
// AuthProvider, so it is a real setting even though the server knows nothing about it.
const KEY = 'gw.console.idleMinutes';
export const IDLE_CHOICES = [15, 30, 60, 120] as const;
const DEFAULT = 30;

export function getIdleMinutes(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (IDLE_CHOICES as readonly number[]).includes(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setIdleMinutes(minutes: number): void {
  try {
    localStorage.setItem(KEY, String(minutes));
  } catch {
    /* storage blocked: the default applies */
  }
}
