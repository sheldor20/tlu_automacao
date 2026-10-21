"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Button, Field } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase";
import { initials } from "@/lib/format";
import styles from "./profile.module.css";

const fields = [
  ["full_name", "Nome completo", 120],
  ["phone", "Telefone", 30],
  ["city", "Cidade / estado", 100],
  ["job_title", "Cargo ou função", 120],
  ["team", "Equipe / setor", 120],
  ["professional_url", "LinkedIn ou site profissional", 300],
] as const;

export default function ProfilePage() {
  const supabase = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function load() {
      try {
        const { data, error } = await supabase!.auth.getUser();
        if (error || !data.user) throw error || new Error("Entre novamente para editar seu perfil.");
        const profile = await supabase!.from("profiles").select("full_name").eq("user_id", data.user.id).single();
        if (profile.error) throw profile.error;
        const metadata = data.user.user_metadata;
        const loaded = Object.fromEntries([...fields.map(([key]) => [key, typeof metadata[key] === "string" ? metadata[key] : ""]), ["bio", typeof metadata.bio === "string" ? metadata.bio : ""]]);
        loaded.full_name = profile.data.full_name || loaded.full_name;
        let url = "";
        if (typeof metadata.avatar_path === "string" && metadata.avatar_path.startsWith(`${data.user.id}/`)) {
          const signed = await supabase!.storage.from("profile-avatars").createSignedUrl(metadata.avatar_path, 3600);
          if (signed.error) throw signed.error;
          url = signed.data.signedUrl;
        }
        if (active) { setUser(data.user); setValues(loaded); setPhoto(url); }
      } catch (e) { if (active) setError(friendlyError(e)); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [supabase]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user) return;
    await run(async () => {
      const cleaned = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
      if (!cleaned.full_name) throw new Error("Informe seu nome completo.");
      const result = await supabase.auth.updateUser({ data: cleaned });
      if (result.error) throw result.error;
      setUser(result.data.user);
      window.dispatchEvent(new Event("personal-profile-changed"));
    }, "Perfil atualizado com sucesso.");
  }

  async function changePhoto(file: File | null) {
    if (!supabase || !user) return;
    await run(async () => {
      let path: string | null = null;
      let url = "";
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
        if (file.size > 2 * 1024 * 1024) throw new Error("A foto deve ter no máximo 2 MB.");
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
        path = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage.from("profile-avatars").upload(path, file, { contentType: file.type });
        if (upload.error) throw upload.error;
        const signed = await supabase.storage.from("profile-avatars").createSignedUrl(path, 3600);
        if (signed.error) { await supabase.storage.from("profile-avatars").remove([path]); throw signed.error; }
        url = signed.data.signedUrl;
      }
      const updated = await supabase.auth.updateUser({ data: { avatar_path: path } });
      if (updated.error) {
        if (path) await supabase.storage.from("profile-avatars").remove([path]);
        throw updated.error;
      }
      const old = user.user_metadata.avatar_path;
      setUser(updated.data.user); setPhoto(url);
      window.dispatchEvent(new Event("personal-profile-changed"));
      if (typeof old === "string" && old.startsWith(`${user.id}/`)) await supabase.storage.from("profile-avatars").remove([old]);
    }, file ? "Foto atualizada." : "Foto removida.");
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user?.email) return;
    await run(async () => {
      if (password !== confirmation) throw new Error("A confirmação deve ser igual à nova senha.");
      if (password === currentPassword) throw new Error("Escolha uma senha diferente da atual.");
      const verified = await supabase.auth.signInWithPassword({ email: user.email!, password: currentPassword });
      if (verified.error) throw new Error("A senha atual está incorreta ou não foi possível confirmar seu acesso.");
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;
      setCurrentPassword(""); setPassword(""); setConfirmation("");
    }, "Senha alterada com sucesso.");
  }

  return <div className={styles.page}>
    <header><span className={styles.eyebrow}>SUA CONTA</span><h1>Meu perfil</h1><p>Cuide das suas informações e da segurança do seu acesso.</p></header>
    <div aria-live="polite">{error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}</div>
    {loading ? <p>Carregando seu perfil…</p> : user ? <>
      <section className={styles.card}><h2>Foto do perfil</h2><div className={styles.photoRow}>
        <div className={styles.avatar}>{photo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photo} alt="Sua foto do perfil" /> : initials(values.full_name || user.email || "Usuário")}</div>
        <div><Field label="Selecionar nova foto" hint="JPG, PNG ou WebP, até 2 MB. A alteração é salva automaticamente."><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void changePhoto(file); event.target.value = ""; }} /></Field>{photo && <Button variant="ghost" disabled={busy} onClick={() => void changePhoto(null)}>Remover foto</Button>}</div>
      </div></section>
      <form className={styles.card} onSubmit={save}><h2>Informações pessoais e profissionais</h2><p>Os dados profissionais são informativos. Os acessos continuam definidos pela administração.</p><fieldset disabled={busy} className={styles.grid}>
        <Field label="E-mail de acesso" hint="Para alterar o e-mail, entre em contato com a administração."><input value={user.email || ""} disabled type="email" /></Field>
        {fields.map(([key, label, maxLength]) => <Field key={key} label={label}><input type={key === "phone" ? "tel" : key === "professional_url" ? "url" : "text"} value={values[key] || ""} maxLength={maxLength} required={key === "full_name"} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} /></Field>)}
        <Field label="Sobre mim" className={styles.wide}><textarea rows={3} maxLength={500} value={values.bio || ""} onChange={e => setValues(v => ({ ...v, bio: e.target.value }))} /></Field>
      </fieldset><Button type="submit" disabled={busy}>Salvar informações</Button></form>
      <form className={styles.card} onSubmit={changePassword}><h2>Segurança</h2><p>Use uma senha exclusiva com pelo menos 12 caracteres.</p><fieldset disabled={busy} className={styles.grid}>
        <Field label="Senha atual"><input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} maxLength={128} /></Field>
        <Field label="Nova senha"><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <Field label="Confirmar nova senha"><input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></Field>
      </fieldset><Button type="submit" disabled={busy}>Alterar senha</Button></form>
    </> : null}
  </div>;
}
