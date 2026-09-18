'use client';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, KeyRound, Plus, RefreshCw, Search, Store, Ticket, X } from 'lucide-react';
import { Button, Field } from './ui';
import { clubFetch } from '@/lib/club-client';
import {
  CLUB_LABELS, formatClubCode, localDateTimeInput, usageRate, validClubCode, voucherState,
  type ClubData, type ClubMember, type ClubOffer, type ClubPartner, type ClubTab, type ClubVoucher,
} from '@/lib/club';
import s from './club.module.css';

type Editor = { kind: 'partner'; item?: ClubPartner } | { kind: 'offer'; item?: ClubOffer } | { kind: 'member' };
const date = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir.';
const text = (form: FormData, key: string) => String(form.get(key) || '').trim();
const optionalNumber = (form: FormData, key: string) => text(form, key) ? Number(text(form, key)) : null;

export function ClubModal({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog className={s.dialog} ref={ref} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={s.dialogHead}><h2 id={titleId}>{title}</h2>
      <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={22} /></button>
    </header>{children}
  </dialog>;
}
function Badge({ status }: { status: string }) {
  return <span className={s.badge} data-state={status}>{CLUB_LABELS[status] || status}</span>;
}
function CouponDetails({ coupon, onCopy }: { coupon: ClubVoucher; onCopy: (code: string) => void }) {
  const status = coupon.state || voucherState(coupon);
  return <div className={s.couponDetails}>
    <Badge status={status} /><h3>{coupon.snapshot.benefit}</h3><p>{coupon.snapshot.partner_name} · {coupon.snapshot.title}</p>
    {coupon.code ? <div className={s.codeBlock}><code>{formatClubCode(coupon.code)}</code>
      <Button type="button" variant="secondary" onClick={() => onCopy(coupon.code!)}><Copy size={16} />Copiar código</Button></div> : null}
    <p>Retirado em {date(coupon.issued_at)}<br />Válido até {date(coupon.expires_at)}</p>
    {coupon.redeemed_at ? <p className={s.success}>Utilizado em {date(coupon.redeemed_at)}</p> : null}
    <h4>Regras deste cupom</h4><p className={s.rules}>{coupon.snapshot.rules}</p>
    <small>As condições acima são as aceitas na retirada. O uso é confirmado pelo parceiro.</small>
  </div>;
}

export function ClubWorkspace({ external = false }: { external?: boolean }) {
  const [tab, setTab] = useState<ClubTab>('offers');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [partner, setPartner] = useState('');
  const [data, setData] = useState<ClubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [details, setDetails] = useState<ClubOffer | null>(null);
  const [coupon, setCoupon] = useState<ClubVoucher | null>(null);
  const [credentials, setCredentials] = useState<ClubMember | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState<ClubVoucher | null>(null);
  const [memberKind, setMemberKind] = useState<'partner' | 'client'>('partner');
  const [clientQuery, setClientQuery] = useState('');
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [clientId, setClientId] = useState('');
  const [clientSearchBusy, setClientSearchBusy] = useState(false);
  const revision = useRef(0);
  const operationLock = useRef(false);
  const claimKeys = useRef(new Map<string, string>());
  const role = data?.actor.role;
  const manager = role === 'manager';
  const staff = manager || role === 'viewer';
  const canEditOffers = manager || role === 'partner';
  const canRedeem = canEditOffers;

  const load = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ tab: tab === 'redeem' ? 'vouchers' : tab, page: String(page), q: search, status });
      if (partner) params.set('partner', partner);
      const result = await clubFetch<ClubData>(`/api/club?${params}`);
      if (current === revision.current) { setData(result); setError(''); }
    } catch (cause) {
      if (current === revision.current) setError(message(cause));
    } finally { if (current === revision.current) setLoading(false); }
  }, [tab, page, search, status, partner]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); revision.current++; };
  }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !operationLock.current) void load(); };
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [load]);

  function changeTab(next: ClubTab) {
    setData(current => current ? { ...current, items: [], total: 0 } : null);
    if (!['offers', 'vouchers'].includes(next)) setPartner('');
    setTab(next); setPage(0); setQuery(''); setSearch(''); setStatus('all'); setVerified(null); setError(''); setNotice('');
  }
  async function command<T>(action: string, payload: unknown): Promise<T | null> {
    if (operationLock.current) return null;
    operationLock.current = true; setBusy(true); setError(''); setNotice('');
    try { return await clubFetch<T>('/api/club', { action, data: payload }); }
    catch (cause) { setError(message(cause)); return null; }
    finally { operationLock.current = false; setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(formatClubCode(value)); setNotice('Código copiado.'); }
    catch { setNotice('Selecione o código e copie manualmente.'); }
  }
  async function claim(offer: ClubOffer) {
    const key = `tlu-club-claim:${data?.actor.client_id}:${offer.id}`;
    let requestId = claimKeys.current.get(key);
    try { requestId = requestId || window.sessionStorage.getItem(key) || undefined; } catch { /* Storage may be disabled. */ }
    if (!requestId) requestId = crypto.randomUUID();
    claimKeys.current.set(key, requestId);
    try { window.sessionStorage.setItem(key, requestId); } catch { /* In-memory idempotency remains available. */ }
    const result = await command<ClubVoucher>('claim', { offer_id: offer.id, request_id: requestId });
    if (result) {
      claimKeys.current.delete(key);
      try { window.sessionStorage.removeItem(key); } catch { /* No persistence to clear. */ }
      setDetails(null); setCoupon(result); setNotice('Cupom retirado. Apresente o código ao parceiro.'); await load();
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    let payload: Record<string, unknown>;
    if (editor.kind === 'partner') {
      payload = { ...(editor.item ? { id: editor.item.id } : {}), name: text(form, 'name'),
        category: text(form, 'category'), city: text(form, 'city'), contact_email: text(form, 'contact_email'),
        contact_phone: text(form, 'contact_phone'), active: text(form, 'active') === 'true' };
    } else if (editor.kind === 'offer') {
      if (![text(form, 'starts_at'), text(form, 'ends_at')].every(v => Number.isFinite(new Date(v).getTime()))) {
        setError('Informe datas válidas para a oferta.'); return;
      }
      payload = { ...(editor.item ? { id: editor.item.id, version: editor.item.version } : {}),
        partner_id: editor.item?.partner_id || (role === 'partner' ? data?.actor.partner_id : text(form, 'partner_id')),
        title: text(form, 'title'), benefit: text(form, 'benefit'), description: text(form, 'description'),
        rules: text(form, 'rules'), status: text(form, 'status'),
        starts_at: new Date(text(form, 'starts_at')).toISOString(), ends_at: new Date(text(form, 'ends_at')).toISOString(),
        max_issues: optionalNumber(form, 'max_issues'), redemption_days: optionalNumber(form, 'redemption_days'),
        per_client_limit: Number(text(form, 'per_client_limit')) };
    } else {
      payload = { email: text(form, 'email'), kind: memberKind,
        partner_id: memberKind === 'partner' ? text(form, 'partner_id') : null,
        client_id: memberKind === 'client' ? clientId : null };
    }
    const result = await command(editor.kind, payload);
    if (result) { setEditor(null); setNotice(editor.kind === 'member' ? 'Usuário cadastrado. Agora defina a senha de acesso.' : 'Alterações salvas.'); await load(); }
  }
  async function findClients() {
    setClientSearchBusy(true); setError('');
    try {
      const result = await clubFetch<{ items: typeof clientOptions }>(`/api/club?tab=clients&q=${encodeURIComponent(clientQuery)}`);
      setClientOptions(result.items); setClientId('');
      if (!result.items.length) setNotice('Nenhum cliente encontrado. Busque pelo nome ou ID da carteira.');
    } catch (cause) { setError(message(cause)); }
    finally { setClientSearchBusy(false); }
  }
  async function toggleMember(member: ClubMember) {
    if (!window.confirm(`${member.active ? 'Desativar' : 'Reativar'} o acesso de ${member.email}?`)) return;
    if (await command('member', { id: member.id, active: !member.active })) { setNotice('Acesso atualizado.'); await load(); }
  }
  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credentials) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password !== String(form.get('confirmation') || '')) { setError('As senhas não coincidem.'); return; }
    const result = await command<{ message: string }>('credentials', { id: credentials.id, password });
    if (result) { setCredentials(null); setNotice(result.message); await load(); }
  }
  async function check(event: FormEvent) {
    event.preventDefault(); setVerified(null);
    const result = await command<ClubVoucher>('check', { code });
    if (result) setVerified(result);
  }
  async function redeem() {
    if (!verified || verified.state !== 'available') return;
    const result = await command<ClubVoucher>('redeem', { code });
    if (result) { setVerified({ ...verified, ...result }); setNotice('Uso confirmado. Este cupom não pode ser utilizado novamente.'); await load(); }
    else setVerified(null);
  }

  const tabs: Array<[ClubTab, string]> = [
    ['offers', role === 'partner' ? 'Meus descontos' : 'Descontos'],
    ...(staff ? [['partners', 'Parceiros'] as [ClubTab, string]] : []),
    ['vouchers', role === 'client' ? 'Meus cupons' : 'Retiradas e uso'],
    ...(canRedeem ? [['redeem', 'Validar cupom'] as [ClubTab, string]] : []),
    ...(manager ? [['members', 'Usuários do clube'] as [ClubTab, string]] : []),
  ];
  const statuses = tab === 'offers' ? ['active', 'scheduled', 'draft', 'paused', 'expired']
    : tab === 'vouchers' ? ['available', 'used', 'expired'] : ['active', 'inactive'];
  const selectedOffer = editor?.kind === 'offer' ? editor.item : undefined;
  const selectedPartner = editor?.kind === 'partner' ? editor.item : undefined;

  return <section className={s.workspace} aria-busy={loading}>
    <header className={s.header}>
      <div><span className={s.eyebrow}>{role === 'partner' ? 'Ambiente do parceiro' : role === 'client' ? 'Benefícios para você' : 'Clientes'}</span>
        <h1>{external && data ? data.actor.name : 'Clube TLU'}</h1>
        <p>{role === 'partner' ? 'Cadastre descontos e confirme o uso dos seus cupons.' : role === 'client'
          ? 'Escolha um desconto, retire seu cupom e apresente o código ao parceiro.' : 'Parceiros, descontos e controle de retiradas em um só lugar.'}</p></div>
      <div className={s.actions}>
        {!external ? <Link className="button button-secondary" href="/clube-tlu" target="_blank" rel="noopener noreferrer">Portal do clube</Link> : null}
        <Button variant="secondary" onClick={() => void load()} disabled={loading || busy} aria-label="Atualizar clube"><RefreshCw size={17} />Atualizar</Button>
      </div>
    </header>
    {error ? <div role="alert" className={s.error}>{error}</div> : null}
    {notice ? <div role="status" className={s.notice}>{notice}</div> : null}
    {!data ? <div className={s.empty}><Ticket size={32} /><h2>{loading ? 'Carregando o clube…' : 'Acesso indisponível'}</h2>
      <p>{loading ? 'Consultando seus descontos e cupons.' : 'Solicite à equipe TLU a liberação do seu e-mail. Parceiros e clientes acessam apenas o próprio ambiente.'}</p></div> : <>
      <div className={s.metrics}>
        {([['Retirados', data.stats.issued], ['Utilizados', data.stats.used], ['Disponíveis para uso', data.stats.available], ['Expirados sem uso', data.stats.expired]] as const)
          .map(([label, value]) => <article key={label}><span>{label}</span><strong>{value.toLocaleString('pt-BR')}</strong></article>)}
      </div>
      <p className={s.hint}>Taxa de uso: <strong>{usageRate(data.stats).toLocaleString('pt-BR')}%</strong>. Retirados = utilizados + disponíveis + expirados. Totais acumulados{partner ? ' do parceiro selecionado' : ''}.</p>
      <nav className={s.tabs} aria-label="Áreas do Clube TLU">{tabs.map(([key, label]) =>
        <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}>{label}</button>)}</nav>
      {tab !== 'redeem' ? <>
        <div className={s.toolbar}>
          <label className={s.search}><Search size={18} /><input aria-label="Buscar nesta área" value={query} maxLength={120}
            placeholder={tab === 'members' ? 'E-mail, parceiro ou cliente' : 'Buscar por nome ou desconto'}
            onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
          {!(role === 'client' && tab === 'offers') ? <select aria-label="Filtrar situação" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
            <option value="all">Todas as situações</option>{statuses.map(value => <option key={value} value={value}>{CLUB_LABELS[value]}</option>)}
          </select> : null}
          {staff && ['offers', 'vouchers'].includes(tab) ? <select aria-label="Filtrar parceiro" value={partner}
            onChange={event => { setPartner(event.target.value); setPage(0); }}><option value="">Todos os parceiros</option>
            {data.partners.map(p => <option value={p.id} key={p.id}>{p.name}{p.active ? '' : ' (inativo)'}</option>)}</select> : null}
          {((tab === 'offers' && canEditOffers) || (tab === 'partners' && manager) || (tab === 'members' && manager)) ?
            <Button onClick={() => {
              setEditor(tab === 'offers' ? { kind: 'offer' } : tab === 'partners' ? { kind: 'partner' } : { kind: 'member' });
              setError(''); setMemberKind('partner'); setClientOptions([]); setClientQuery(''); setClientId('');
            }}><Plus size={17} />{tab === 'offers' ? 'Novo desconto' : tab === 'partners' ? 'Novo parceiro' : 'Novo acesso'}</Button> : null}
        </div>
        <p className={s.hint}>{data.total.toLocaleString('pt-BR')} registros{loading ? ' · Atualizando…' : ''}</p>
        {!data.items.length ? <div className={s.empty}><Ticket size={30} /><h2>Nenhum registro nesta seleção</h2>
          <p>{tab === 'offers' ? role === 'client' ? 'Novos benefícios aparecerão aqui quando forem publicados.' : 'Cadastre um desconto ou ajuste os filtros.'
            : tab === 'vouchers' ? 'As retiradas aparecem aqui assim que os clientes gerarem seus cupons.'
            : tab === 'members' ? 'Cadastre o e-mail e vincule a um parceiro ou cliente. Depois, defina a senha.' : 'Comece cadastrando os estabelecimentos participantes.'}</p></div> : null}
        {tab === 'offers' ? <div className={s.grid}>{(data.items as ClubOffer[]).map(offer => {
          const soldOut = offer.max_issues !== null && offer.issued_count >= offer.max_issues;
          const limitReached = offer.own_count >= offer.per_client_limit;
          return <article className={s.card} key={offer.id}>
            <div className={s.cardTop}><span><Store size={16} />{offer.partner_name}</span><Badge status={offer.display_status} /></div>
            <h2>{offer.benefit}</h2><h3>{offer.title}</h3>
            {offer.description ? <p className={s.excerpt}>{offer.description}</p> : null}
            <p className={s.hint}>{offer.category}{offer.city ? ` · ${offer.city}` : ''}<br />Até {date(offer.ends_at)}</p>
            {role !== 'client' ? <div className={s.cardMetrics}><span>Retirados <strong>{offer.issued_count}</strong></span>
              <span>Utilizados <strong>{offer.used_count}</strong></span>
              <span>Limite total <strong>{offer.max_issues ?? 'Sem limite'}</strong></span></div>
              : <p className={s.hint}>{offer.max_issues !== null ? `${Math.max(0, offer.max_issues - offer.issued_count)} cupons restantes · ` : ''}
                {offer.per_client_limit} por cliente{offer.own_count ? ` · Você retirou ${offer.own_count}` : ''}</p>}
            <div className={s.actions}><Button variant="secondary" onClick={() => setDetails(offer)}>Regras e detalhes</Button>
              {canEditOffers ? <Button variant="secondary" onClick={() => { setEditor({ kind: 'offer', item: offer }); setError(''); }}>Editar</Button> : null}
              {role === 'client' ? <Button disabled={busy || soldOut || limitReached} onClick={() => setDetails(offer)}>
                {limitReached ? 'Limite atingido' : soldOut ? 'Esgotado' : 'Retirar cupom'}</Button> : null}</div>
          </article>;
        })}</div> : null}
        {tab === 'partners' ? <div className={s.grid}>{(data.items as ClubPartner[]).map(p => <article className={s.card} key={p.id}>
          <div className={s.cardTop}><Store size={20} /><Badge status={p.active ? 'active' : 'inactive'} /></div><h2>{p.name}</h2>
          <p>{p.category}{p.city ? ` · ${p.city}` : ''}</p><p className={s.hint}>{p.contact_email || 'E-mail de contato não informado'}<br />{p.contact_phone}</p>
          <div className={s.cardMetrics}><span>Descontos <strong>{p.offers_count}</strong></span><span>Retirados <strong>{p.issued_count}</strong></span><span>Utilizados <strong>{p.used_count}</strong></span></div>
          <div className={s.actions}><Button variant="secondary" onClick={() => { setPartner(p.id); changeTab('offers'); }}>Ver descontos</Button>
            {manager ? <Button onClick={() => { setEditor({ kind: 'partner', item: p }); setError(''); }}>Editar parceiro</Button> : null}</div>
        </article>)}</div> : null}
        {tab === 'vouchers' ? <div className={s.grid}>{(data.items as ClubVoucher[]).map(v => <article key={v.id} className={s.card}>
          <div className={s.cardTop}><span>{v.snapshot.partner_name}</span><Badge status={v.state || voucherState(v)} /></div>
          <h2>{v.snapshot.benefit}</h2><h3>{v.snapshot.title}</h3>
          <p className={s.hint}>Retirado: {date(v.issued_at)}<br />Validade: {date(v.expires_at)}{v.redeemed_at ? <><br />Utilizado: {date(v.redeemed_at)}</> : null}</p>
          {v.code ? <code className={s.inlineCode}>{formatClubCode(v.code)}</code> : <p className={s.hint}>O código é apresentado pelo cliente no atendimento.</p>}
          <Button variant="secondary" onClick={() => setCoupon(v)}>Ver cupom</Button>
        </article>)}</div> : null}
        {tab === 'members' ? <div className={s.grid}>{(data.items as ClubMember[]).map(m => <article key={m.id} className={s.card}>
          <div className={s.cardTop}><span>{CLUB_LABELS[m.kind]}</span><Badge status={m.active ? 'active' : 'inactive'} /></div>
          <h3>{m.owner_name}</h3><p>{m.email}</p><p className={s.hint}>{m.password_ready ? 'Login e senha configurados' : 'Aguardando definição de senha'}{m.last_login_at ? <><br />Último acesso: {date(m.last_login_at)}</> : null}</p><div className={s.actions}>
            <Button disabled={busy || !m.active} onClick={() => { setCredentials(m); setError(''); }}><KeyRound size={16} />{m.password_ready ? 'Redefinir senha' : 'Definir senha'}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void toggleMember(m)}>{m.active ? 'Desativar' : 'Reativar'}</Button>
          </div></article>)}</div> : null}
        {(page > 0 || data.total > data.page_size) ? <div className={s.pagination}>
          <Button variant="secondary" disabled={!page || loading} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {Math.max(1, Math.ceil(data.total / data.page_size))}</span>
          <Button variant="secondary" disabled={(page + 1) * data.page_size >= data.total || loading} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div> : null}
      </> : canRedeem ? <div className={s.redeem}>
        <div><span className={s.icon}><Ticket size={27} /></span><h2>Validar cupom do cliente</h2>
          <p>Digite ou cole o código. Confira o benefício e as regras antes de confirmar o uso.</p></div>
        <form className={s.form} onSubmit={check}>
          <Field label="Código do cupom"><input value={code} disabled={busy} maxLength={80} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            placeholder="TLU-0000-0000-0000-0000-0000" onChange={event => { setCode(event.target.value); setVerified(null); }} required /></Field>
          <Button disabled={busy || !validClubCode(code)} loading={busy} type="submit">Consultar código</Button>
        </form>
        {verified ? <div className={s.validation}><CouponDetails coupon={verified} onCopy={copy} />
          {verified.state === 'available' ? <Button disabled={busy} onClick={() => void redeem()}><CheckCircle2 size={18} />Confirmar utilização</Button>
            : <p className={s.hint}>Este cupom não está disponível para utilização.</p>}</div> : null}
      </div> : null}
    </>}
    {editor ? <ClubModal title={editor.kind === 'partner' ? selectedPartner ? 'Editar parceiro' : 'Novo parceiro'
      : editor.kind === 'offer' ? selectedOffer ? 'Editar desconto' : 'Novo desconto' : 'Novo acesso ao clube'}
      onClose={() => setEditor(null)} busy={busy}>
      <form className={s.form} onSubmit={save}>
        {error ? <p role="alert" className={s.error}>{error}</p> : null}
        {editor.kind === 'partner' ? <>
          <Field label="Nome do parceiro"><input name="name" defaultValue={selectedPartner?.name} minLength={2} maxLength={120} required autoFocus /></Field>
          <div className={s.formGrid}><Field label="Categoria"><input name="category" defaultValue={selectedPartner?.category || 'Geral'} maxLength={80} required /></Field>
            <Field label="Cidade"><input name="city" defaultValue={selectedPartner?.city} maxLength={100} /></Field></div>
          <Field label="E-mail de contato" hint="O login é cadastrado separadamente na aba Acessos."><input type="email" name="contact_email" defaultValue={selectedPartner?.contact_email} maxLength={254} /></Field>
          <Field label="Telefone"><input name="contact_phone" type="tel" defaultValue={selectedPartner?.contact_phone} maxLength={40} /></Field>
          <Field label="Situação" hint="Inativar bloqueia novas retiradas e a validação dos cupons deste parceiro."><select name="active" defaultValue={String(selectedPartner?.active ?? true)}>
            <option value="true">Ativo</option><option value="false">Inativo</option></select></Field>
        </> : editor.kind === 'offer' ? <>
          {role !== 'partner' ? <Field label="Parceiro"><select name="partner_id" defaultValue={selectedOffer?.partner_id || partner} disabled={!!selectedOffer} required>
            <option value="">Selecione</option>{data?.partners.filter(p => p.active || p.id === selectedOffer?.partner_id).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></Field> : null}
          <Field label="Nome do desconto"><input name="title" defaultValue={selectedOffer?.title} minLength={3} maxLength={140} required autoFocus /></Field>
          <Field label="Benefício" hint="Ex.: 20% de desconto no almoço ou R$ 30 de desconto."><input name="benefit" defaultValue={selectedOffer?.benefit} minLength={3} maxLength={140} required /></Field>
          <Field label="Descrição"><textarea name="description" defaultValue={selectedOffer?.description} maxLength={2000} rows={2} /></Field>
          <Field label="Regras de utilização" hint="Informe dias, horários, produtos elegíveis, compra mínima e restrições."><textarea name="rules" defaultValue={selectedOffer?.rules} minLength={5} maxLength={5000} rows={4} required /></Field>
          <div className={s.formGrid}><Field label="Início"><input type="datetime-local" name="starts_at" defaultValue={localDateTimeInput(selectedOffer?.starts_at || new Date().toISOString())} required /></Field>
            <Field label="Fim"><input type="datetime-local" name="ends_at" defaultValue={localDateTimeInput(selectedOffer?.ends_at || new Date(Date.now() + 30 * 86400000).toISOString())} required /></Field></div>
          <p className={s.hint}>Horários do seu dispositivo. A validade do cupom nunca ultrapassa o fim da oferta.</p>
          <div className={s.formGrid}><Field label="Limite total de cupons" hint="Vazio = sem limite."><input name="max_issues" type="number" min={1} max={1000000} step={1} defaultValue={selectedOffer?.max_issues ?? ''} /></Field>
            <Field label="Limite por cliente"><input name="per_client_limit" type="number" min={1} max={100} step={1} defaultValue={selectedOffer?.per_client_limit ?? 1} required /></Field></div>
          <Field label="Dias para utilizar após a retirada" hint="Vazio = até o fim da oferta."><input name="redemption_days" type="number" min={1} max={365} step={1} defaultValue={selectedOffer?.redemption_days ?? ''} /></Field>
          <Field label="Publicação" hint="Pausar impede novas retiradas, mas preserva cupons já emitidos."><select name="status" defaultValue={selectedOffer?.status || 'draft'}>
            <option value="draft">Rascunho</option><option value="active">Publicado</option><option value="paused">Pausado</option></select></Field>
          {selectedOffer ? <p className={s.hint}>Alterações valem apenas para novas retiradas. Os cupons existentes mantêm suas regras e validade.</p> : null}
        </> : <>
          <Field label="Tipo de acesso"><select value={memberKind} onChange={event => setMemberKind(event.target.value as 'partner' | 'client')}>
            <option value="partner">Parceiro</option><option value="client">Cliente</option></select></Field>
          {memberKind === 'partner' ? <Field label="Parceiro"><select name="partner_id" required defaultValue={partner}>
            <option value="">Selecione</option>{data?.partners.filter(p => p.active).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>
            : <><Field label="Buscar na carteira de clientes"><div className={s.searchRow}>
              <input value={clientQuery} onChange={event => setClientQuery(event.target.value)} placeholder="Nome ou ID do cliente" minLength={2} maxLength={120} />
              <Button type="button" variant="secondary" disabled={clientQuery.trim().length < 2 || clientSearchBusy} onClick={() => void findClients()}>{clientSearchBusy ? 'Buscando…' : 'Buscar'}</Button></div></Field>
              <Field label="Cliente da carteira"><select value={clientId} onChange={event => setClientId(event.target.value)} required>
                <option value="">Selecione o cliente encontrado</option>{clientOptions.map(c => <option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></Field></>}
          <Field label="E-mail de acesso" hint="Após salvar, defina a senha. Só esse usuário poderá entrar neste ambiente."><input name="email" type="email" autoComplete="off" maxLength={254} required /></Field>
          <p className={s.hint}>O parceiro vê somente os próprios descontos e cupons. O cliente vê os benefícios publicados e os próprios cupons.</p>
        </>}
        <footer className={s.actions}><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={busy}>Salvar</Button></footer>
      </form>
    </ClubModal> : null}
    {details ? <ClubModal title={details.title} onClose={() => setDetails(null)} busy={busy}>
      {error ? <p role="alert" className={s.error}>{error}</p> : null}
      <div className={s.couponDetails}><Badge status={details.display_status} /><h3>{details.benefit}</h3><p>{details.partner_name}</p>
        <p>{details.description}</p><h4>Regras de utilização</h4><p className={s.rules}>{details.rules}</p>
        <p>Oferta até {date(details.ends_at)}.<br />{details.per_client_limit} retirada(s) por cliente.
          {details.redemption_days ? <><br />Utilize em até {details.redemption_days} dias da retirada, respeitando o fim da oferta.</> : null}</p>
        {role === 'client' ? <Button disabled={busy || details.own_count >= details.per_client_limit || (details.max_issues !== null && details.issued_count >= details.max_issues)}
          loading={busy} onClick={() => void claim(details)}>Aceitar regras e retirar cupom</Button> : null}
      </div>
    </ClubModal> : null}
    {credentials ? <ClubModal title={credentials.password_ready ? "Redefinir senha" : "Definir senha de acesso"} onClose={() => setCredentials(null)} busy={busy}>
      <form className={s.form} onSubmit={saveCredentials}>
        <p><strong>{credentials.owner_name}</strong><br />{credentials.email}</p>
        <p className={s.hint}>Esta senha é exclusiva do portal Clube TLU. O perfil será identificado automaticamente como {CLUB_LABELS[credentials.kind]}.</p>
        <Field label="Senha"><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required autoFocus /></Field>
        <Field label="Confirmar senha"><input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
        {error ? <p role="alert" className={s.error}>{error}</p> : null}
        <footer className={s.actions}><Button type="button" variant="secondary" disabled={busy} onClick={() => setCredentials(null)}>Cancelar</Button><Button type="submit" loading={busy}>Salvar login e senha</Button></footer>
      </form>
    </ClubModal> : null}
    {coupon ? <ClubModal title="Detalhes do cupom" onClose={() => setCoupon(null)}><CouponDetails coupon={coupon} onCopy={copy} />
      {notice ? <p role="status" className={s.notice}>{notice}</p> : null}
    </ClubModal> : null}
  </section>;
}
