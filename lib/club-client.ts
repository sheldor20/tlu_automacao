import { getSupabase } from './supabase';
export async function clubFetch<T>(path: string, body?: unknown): Promise<T> {
  const session = await getSupabase()?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('Entre no clube para continuar.');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result as T;
}
