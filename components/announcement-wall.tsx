"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabase, friendlyError } from "@/lib/supabase";
import { Button } from "@/components/ui";
import "./announcement-wall.css";
export async function announcementRequest(
  path = "",
  method = "GET",
  body?: unknown,
) {
  const s = await getSupabase()?.auth.getSession();
  const token = s?.data.session?.access_token;
  if (!token) throw new Error("Entre novamente para acessar o mural.");
  const response = await fetch(`/api/announcements${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Não foi possível atualizar o mural.");
  return data;
}
type Comment = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};
type Post = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  media_url: string | null;
  media_path: string | null;
  comments: Comment[];
  reactions: { user_id: string; reaction: string }[];
};
type Feed = {
  posts: Post[];
  user_id: string;
  admin: boolean;
  can_publish: boolean;
};
const date = (s: string) => new Date(s).toLocaleString("pt-BR");
export function AnnouncementWall() {
  const [feed, setFeed] = useState<Feed | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [fileKey, setFileKey] = useState(0),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [composer, setComposer] = useState(false),
    [editing, setEditing] = useState<Post | null>(null);
  const load = useCallback(async () => {
    try {
      setFeed(await announcementRequest());
      setError("");
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load]);
  async function action(value: unknown) {
    setBusy(true);
    try {
      await announcementRequest("", "PATCH", value);
      await load();
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let media_path = editing?.media_path || null;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        media_path = (await announcementRequest("/upload", "POST", form)).path;
      }
      await announcementRequest("", "POST", {
        id: editing?.id,
        title,
        body,
        media_path,
      });
      setTitle("");
      setBody("");
      setFile(null);
      setFileKey((k) => k + 1);
      setComposer(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="content-card announcement-wall"
      aria-label="Mural de comunicados"
    >
      <div className="content-card-head">
        <div>
          <h2>Mural de comunicados</h2>
          <p>Avisos do RH, endomarketing e novidades da empresa</p>
        </div>
        <div className="page-action-group">
          <Button
            variant="secondary"
            onClick={() => void load()}
            disabled={busy}
          >
            Atualizar mural
          </Button>
          {feed?.can_publish && (
            <Button
              onClick={() => {
                setComposer(!composer);
                setEditing(null);
                setTitle("");
                setBody("");
                setFile(null);
                setFileKey((k) => k + 1);
              }}
              disabled={busy}
            >
              {composer ? "Fechar" : "Novo comunicado"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="announcement-error">
          {error}
        </p>
      )}
      {!feed && !error && <p>Carregando comunicados…</p>}
      {composer && (
        <form className="announcement-compose" onSubmit={publish}>
          <label>
            Título
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Comunicado
            <textarea
              rows={4}
              maxLength={10000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Compartilhe o aviso ou a ação do mês"
            />
          </label>
          <label>
            Imagem ou GIF (até 4 MB)
            <input
              key={fileKey}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <Button
            disabled={busy || (!body.trim() && !file && !editing?.media_path)}
            type="submit"
          >
            {busy
              ? "Salvando…"
              : editing
                ? "Salvar alterações"
                : "Publicar comunicado"}
          </Button>
        </form>
      )}
      {feed?.posts.length === 0 && (
        <p className="announcement-empty">
          Os próximos avisos e ações da empresa aparecerão aqui.
        </p>
      )}
      <div className="announcement-feed">
        {feed?.posts.map((p) => (
          <article key={p.id} className="announcement-post">
            <header>
              <div>
                <h3>{p.title}</h3>
                <small>
                  {p.author_name} ·{" "}
                  <time dateTime={p.created_at}>{date(p.created_at)}</time>
                </small>
              </div>
              {feed.can_publish &&
                (feed.admin || p.author_id === feed.user_id) && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditing(p);
                      setTitle(p.title);
                      setBody(p.body);
                      setFile(null);
                      setFileKey((k) => k + 1);
                      setComposer(true);
                      document
                        .querySelector(".announcement-wall")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Editar
                  </Button>
                )}
              {(feed.admin || p.author_id === feed.user_id) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Excluir este comunicado e suas interações?",
                      )
                    )
                      void action({ action: "delete_post", post_id: p.id });
                  }}
                >
                  Excluir
                </Button>
              )}
            </header>
            {p.body && <p className="announcement-text">{p.body}</p>}
            {p.media_url && (
              <img
                className="announcement-image"
                src={p.media_url}
                alt={`Imagem do comunicado: ${p.title}`}
                loading="lazy"
              />
            )}
            <div className="announcement-reactions" aria-label="Reações">
              {["❤️", "👏", "👍", "🎉"].map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  disabled={busy}
                  aria-label={`Reagir ${emoji}`}
                  aria-pressed={p.reactions.some(
                    (r) => r.user_id === feed.user_id && r.reaction === emoji,
                  )}
                  onClick={() =>
                    void action({
                      action: "react",
                      post_id: p.id,
                      reaction: p.reactions.some(
                        (r) =>
                          r.user_id === feed.user_id && r.reaction === emoji,
                      )
                        ? null
                        : emoji,
                    })
                  }
                >
                  {emoji}{" "}
                  {p.reactions.filter((r) => r.reaction === emoji).length || ""}
                </button>
              ))}
              <span>{p.comments.length} comentário(s)</span>
            </div>
            <details>
              <summary>Comentários ({p.comments.length})</summary>
              <div className="announcement-comments">
                {p.comments.map((c) => (
                  <div key={c.id}>
                    <strong>{c.author_name}</strong>
                    <small> · {date(c.created_at)}</small>
                    <p className="announcement-text">{c.body}</p>
                    {(feed.admin || c.author_id === feed.user_id) && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Excluir este comentário?"))
                            void action({
                              action: "delete_comment",
                              comment_id: c.id,
                            });
                        }}
                      >
                        Excluir comentário
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <form
                className="announcement-comment-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await action({
                      action: "comment",
                      post_id: p.id,
                      body: drafts[p.id] || "",
                    })
                  )
                    setDrafts((v) => ({ ...v, [p.id]: "" }));
                }}
              >
                <label>
                  Seu comentário
                  <textarea
                    required
                    maxLength={2000}
                    rows={2}
                    value={drafts[p.id] || ""}
                    onChange={(e) =>
                      setDrafts((v) => ({ ...v, [p.id]: e.target.value }))
                    }
                  />
                </label>
                <Button type="submit" disabled={busy || !drafts[p.id]?.trim()}>
                  Comentar
                </Button>
              </form>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
