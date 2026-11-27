const origins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function hasLocalGuiersProfile() {
  return process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_GUIERS_LOCAL === '1' &&
    origins.includes(window.location.origin);
}

export async function localGuiersJson(path: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:3001/local/guiers/${path}`, {
    signal, cache: 'no-store', credentials: 'omit',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? `Erreur SIG HTTP ${response.status}.`);
  return data;
}
