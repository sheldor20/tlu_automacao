"use client";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export function ChatNavigation({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const supabase = getSupabase();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const { data, error } = await supabase!.rpc("chat_inbox");
      if (active && !error) setUnread((data || []).reduce((sum: number, c: { unread: number }) => sum + Number(c.unread), 0));
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); };
    schedule();
    const channel = supabase.channel("chat-navigation")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, schedule).subscribe();
    const interval = setInterval(() => { if (document.visibilityState === "visible") schedule(); }, 30000);
    window.addEventListener("chat-unread-changed", schedule);
    window.addEventListener("focus", schedule);
    return () => { active = false; clearTimeout(timer); clearInterval(interval); window.removeEventListener("chat-unread-changed", schedule); window.removeEventListener("focus", schedule); void supabase.removeChannel(channel); };
  }, [supabase]);
  return <Link href="/mensagens" className={pathname.startsWith("/mensagens") ? "nav-link active" : "nav-link"} title="Mensagens" onClick={onNavigate}><MessageCircle size={19} /><span>Mensagens</span>{unread > 0 ? <span className="nav-alert-badge" aria-label={`${unread} mensagens não lidas`}>{unread > 99 ? "99+" : unread}</span> : null}</Link>;
}
