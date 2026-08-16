/** Namespaced localStorage wrapper that degrades to memory when blocked. */

const NS = 'forwardho.v1.';
const memory = new Map<string, string>();

let available = true;
try {
  const probe = `${NS}__probe`;
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
} catch {
  available = false;
}

export function loadRaw(key: string): string | null {
  if (!available) return memory.get(NS + key) ?? null;
  try {
    return localStorage.getItem(NS + key);
  } catch {
    return null;
  }
}

export function saveRaw(key: string, value: string): void {
  if (!available) {
    memory.set(NS + key, value);
    return;
  }
  try {
    localStorage.setItem(NS + key, value);
  } catch {
    memory.set(NS + key, value);
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  const raw = loadRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return { ...(fallback as object), ...(parsed as object) } as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    saveRaw(key, JSON.stringify(value));
  } catch {
    /* nothing sensible to do */
  }
}

export function clearAll(): void {
  if (!available) {
    memory.clear();
    return;
  }
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
