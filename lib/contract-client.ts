import { paymentFetch } from "./payment-client";
import { getSupabase } from "./supabase";
export function contractFetch(path: string, options: RequestInit & { anonymous?: boolean } = {}, token?: string) {
  return paymentFetch(path, { ...options, anonymous: Boolean(token) || options.anonymous, headers: { ...options.headers, ...(token ? { "X-Contract-Token": token } : {}) } });
}
export async function downloadContract(id: string, protocol: string, token?: string) {
  const headers = new Headers();
  if (token) headers.set("X-Contract-Token", token);
  else {
    const session = await getSupabase()?.auth.getSession();
    if (session?.data.session) headers.set("Authorization", `Bearer ${session.data.session.access_token}`);
  }
  const response = await fetch(`/api/contracts/${id}/document`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error((await response.json()).error || "Não foi possível baixar a minuta.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a"); a.href = url; a.download = `minuta-${protocol}.doc`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
