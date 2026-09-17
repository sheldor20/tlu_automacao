"use client";

import { Button, Field, Toast } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { Lightbulb, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

const MAX_IDEA_LENGTH = 5000;

export function TodayIdeaButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
      textareaRef.current?.focus();
    }
  }, [open]);

  function openDialog() {
    setError("");
    setSent(false);
    setOpen(true);
  }

  function closeDialog() {
    if (!submittingRef.current) dialogRef.current?.close();
  }

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const text = message.trim();
    if (!text) {
      setError("Escreva sua ideia antes de enviar.");
      return;
    }
    if (text.length > MAX_IDEA_LENGTH) {
      setError("Sua ideia pode ter até 5.000 caracteres.");
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setError("Não foi possível conectar. Tente novamente em instantes.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      // Author and timestamp come from the authenticated database session,
      // independently of the person selected in the Hoje dashboard.
      const { error: saveError } = await supabase.from("improvement_ideas").insert({ message: text });
      if (saveError) throw saveError;
      setMessage("");
      dialogRef.current?.close();
      setSent(true);
    } catch {
      setError("Não foi possível enviar sua ideia. Seu texto foi mantido; tente novamente.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" className="today-idea-trigger" onClick={openDialog} aria-haspopup="dialog">
        <Lightbulb size={17} aria-hidden="true" /> Enviar ideia
      </Button>

      {open ? createPortal(<dialog
        ref={dialogRef}
        className="dialog-panel today-idea-dialog"
        aria-labelledby="today-idea-title"
        aria-describedby="today-idea-description"
        onClose={() => setOpen(false)}
        onCancel={(event) => { if (submittingRef.current) event.preventDefault(); }}
      >
        <div className="dialog-head">
          <div>
            <h2 id="today-idea-title">Compartilhe sua ideia</h2>
            <p id="today-idea-description">Tem uma ideia para melhorar o TLU Space, facilitar o dia a dia do time ou automatizar uma tarefa? Conte aqui.</p>
          </div>
          <button type="button" className="icon-button" onClick={closeDialog} disabled={submitting} aria-label="Fechar">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form className="dialog-body today-idea-form" onSubmit={submitIdea} aria-busy={submitting}>
          <Field label="Sua ideia">
            <textarea
              ref={textareaRef}
              required
              rows={6}
              maxLength={MAX_IDEA_LENGTH}
              value={message}
              onChange={(event) => { setMessage(event.target.value); setError(""); }}
              disabled={submitting}
              placeholder="O que podemos melhorar?"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "today-idea-error" : undefined}
            />
          </Field>
          {error ? <p id="today-idea-error" className="field-error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={submitting}>Cancelar</Button>
            <Button type="submit" loading={submitting} disabled={submitting || !message.trim()}>
              {submitting ? "Enviando…" : <><Send size={16} aria-hidden="true" /> Enviar ideia</>}
            </Button>
          </div>
        </form>
      </dialog>, document.body) : null}

      {sent ? createPortal(<Toast message="Ideia enviada! Obrigado por ajudar a melhorar o TLU Space." onClose={() => setSent(false)} />, document.body) : null}
    </>
  );
}
