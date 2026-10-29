"use client";
import { useEffect, useState } from "react";
import { announcementRequest } from "./announcement-wall";
import { friendlyError } from "@/lib/supabase";
export function AnnouncementPermissions({
  users,
}: {
  users: {
    user_id: string;
    full_name: string | null;
    active: boolean;
    is_admin: boolean;
  }[];
}) {
  const [allowed, setAllowed] = useState<string[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    announcementRequest("?permissions=1")
      .then((rows) => {
        setAllowed(rows.map((r: { user_id: string }) => r.user_id));
        setReady(true);
      })
      .catch((e) => setError(friendlyError(e)));
  }, []);
  async function change(id: string, value: boolean) {
    setBusy(true);
    setError("");
    try {
      await announcementRequest("", "PATCH", {
        action: "permission",
        user_id: id,
        can_publish: value,
      });
      setAllowed((v) => (value ? [...v, id] : v.filter((x) => x !== id)));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-card">
      <div className="content-card-head">
        <div>
          <h2>Publicação no mural</h2>
          <p>
            Libere quem pode publicar comunicados na aba Hoje. Todos os usuários
            ativos podem reagir e comentar. Administradores já podem publicar e
            moderar.
          </p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!ready && !error && <p>Carregando permissões…</p>}
      <div className="announcement-permissions">
        {users
          .filter((u) => u.active)
          .map((u) => (
            <label key={u.user_id}>
              <input
                type="checkbox"
                disabled={!ready || busy || u.is_admin}
                checked={u.is_admin || allowed.includes(u.user_id)}
                onChange={(e) => void change(u.user_id, e.target.checked)}
              />
              {u.full_name}
              {u.is_admin ? " (administrador)" : ""}
            </label>
          ))}
      </div>
    </section>
  );
}
