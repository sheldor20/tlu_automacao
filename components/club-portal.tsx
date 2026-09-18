'use client';
import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { LogOut, LockKeyhole, Mail, Ticket } from 'lucide-react';
import { getSupabase, friendlyError } from '@/lib/supabase';
import { Button, Field } from './ui';
import { ClubModal, ClubWorkspace } from './club-workspace';
import s from './club.module.css';

export function ClubPortal() {
  const supabase = getSupabase();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [method, setMethod] = useState<'link' | 'password'>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editPassword, setEditPassword] = useState(false);
  useEffect(() => {
    let active = true;
    if (!supabase) {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setAuthenticated(!!data.session); setReady(true); }
    }).catch(() => { if (active) { setReady(true); setError('Não foi possível carregar sua sessão.'); } });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setAuthenticated(!!session); setReady(true); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [supabase]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (method === 'password') {
        const result = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (result.error) throw result.error;
        setAuthenticated(true); setPassword('');
      } else {
        await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(),
          options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/clube-tlu` } });
        setNotice('Se este e-mail já possui acesso, você receberá um link para entrar. Confira também o spam.');
      }
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const first = String(form.get('password') || '');
    if (first !== form.get('confirmation')) { setError('As senhas não coincidem.'); return; }
    setBusy(true); setError('');
    try {
      const result = await supabase.auth.updateUser({ password: first });
      if (result.error) throw result.error;
      setEditPassword(false); setNotice('Senha atualizada. Você também pode continuar usando o link por e-mail.');
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const result = await supabase?.auth.signOut();
      if (result?.error) throw result.error;
      setAuthenticated(false); setNotice(''); setError(''); setEditPassword(false);
    } catch { setError('Não foi possível sair. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return <main className={s.portal}>
    <header className={s.portalHeader}><div className={s.brand}>
      <Image src="/logo-terra-lotus.png" alt="Terra Lótus Urbanismo" width={160} height={60} priority />
      <span>Clube TLU</span></div>
      {authenticated ? <div className={s.actions}>
        <Button variant="secondary" onClick={() => { setEditPassword(true); setError(''); }}>Definir senha</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void logout()}><LogOut size={16} />Sair</Button>
      </div> : null}
    </header>
    {!ready ? <div className={s.empty}>Preparando seu acesso…</div> : !supabase ?
      <div className={s.empty}><h1>Clube temporariamente indisponível</h1><p>Entre em contato com a equipe TLU.</p></div>
      : authenticated ? <>
        {notice ? <div className={s.notice} role="status">{notice}</div> : null}
        {error && !editPassword ? <div className={s.error} role="alert">{error}</div> : null}
        <ClubWorkspace external />
      </> : <section className={s.login}>
        <div className={s.loginIntro}><span className={s.icon}><Ticket size={28} /></span>
          <span className={s.eyebrow}>Clube de benefícios</span><h1>Vantagens que aproximam.</h1>
          <p>Clientes retiram descontos exclusivos. Parceiros cadastram benefícios e acompanham cada utilização.</p>
          <div className={s.steps}><span>01 · Escolha o benefício</span><span>02 · Retire seu código</span><span>03 · Utilize no parceiro</span></div>
        </div>
        <form className={s.loginCard} onSubmit={login}>
          <LockKeyhole size={25} /><h2>Entre no Clube TLU</h2><p>Use o e-mail liberado pela equipe TLU.</p>
          <div className={s.tabs}><button type="button" aria-pressed={method === 'link'} onClick={() => { setMethod('link'); setError(''); }}>Link por e-mail</button>
            <button type="button" aria-pressed={method === 'password'} onClick={() => { setMethod('password'); setError(''); }}>Com senha</button></div>
          <Field label="E-mail"><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required /></Field>
          {method === 'password' ? <Field label="Senha"><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></Field> : null}
          {error ? <p className={s.error} role="alert">{error}</p> : null}
          {notice ? <p className={s.notice} role="status">{notice}</p> : null}
          <Button type="submit" disabled={busy} loading={busy}>{method === 'link' ? <><Mail size={17} />Receber link de acesso</> : 'Entrar'}</Button>
          <small>Não há cadastro público. Solicite seu acesso à equipe Terra Lótus.</small>
        </form>
      </section>}
    {editPassword ? <ClubModal title="Definir senha de acesso" onClose={() => setEditPassword(false)} busy={busy}>
      <form className={s.form} onSubmit={changePassword}>
        <p>Crie uma senha com pelo menos 12 caracteres. O acesso por e-mail continua disponível.</p>
        <Field label="Nova senha"><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required autoFocus /></Field>
        <Field label="Confirme a senha"><input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
        {error ? <p className={s.error} role="alert">{error}</p> : null}
        <Button type="submit" disabled={busy} loading={busy}>Salvar senha</Button>
      </form>
    </ClubModal> : null}
  </main>;
}
