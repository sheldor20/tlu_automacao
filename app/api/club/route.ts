import { clubBodySchema, clubQuerySchema, clubServer, clubJson, clubFailure, ClubError } from '@/lib/club-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { db, actor } = await clubServer(request);
    const params = new URL(request.url).searchParams;
    if (params.get('me') === '1') {
      const { data, error } = await db.rpc('club_context', { p_actor: actor });
      if (error) throw error;
      return clubJson(data);
    }
    const q = clubQuerySchema.parse(Object.fromEntries(params));
    const { data, error } = await db.rpc('club_workspace', {
      p_actor: actor, p_tab: q.tab, p_page: q.page, p_search: q.q,
      p_status: q.status, p_partner: q.partner || null,
    });
    if (error) throw error;
    return clubJson(data);
  } catch (error) { return clubFailure(error); }
}
export async function POST(request: Request) {
  try {
    // Bearer-only authentication: no cookie-based write endpoint or token in a URL.
    const { db, actor } = await clubServer(request);
    if (Number(request.headers.get('content-length') || 0) > 24000) throw new ClubError('Formulário muito grande.', 413);
    const raw = await request.text();
    if (raw.length > 24000) throw new ClubError('Formulário muito grande.', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ClubError('Formulário inválido.'); }
    const { action, data: payload } = clubBodySchema.parse(body);
    const rate = await db.rpc('club_rate_limit', { p_actor: actor, p_action: action });
    if (rate.error) throw rate.error;
    if (!rate.data) return clubJson({ error: 'Muitas tentativas. Tente novamente em um minuto.' }, 429);
    if (action === 'invite') {
      const target = await db.rpc('club_invite_target', { p_actor: actor, p_id: payload.id });
      if (target.error) throw target.error;
      const redirectTo = `${new URL(request.url).origin}/clube-tlu`;
      // Explicit manager action only; no automatic email blast.
      const sent = target.data.registered
        ? await db.auth.signInWithOtp({ email: target.data.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
        : await db.auth.admin.inviteUserByEmail(target.data.email, { redirectTo });
      if (sent.error) throw new ClubError('O acesso foi salvo, mas o e-mail não foi enviado. Verifique o serviço de autenticação e tente reenviar.', 502);
      return clubJson({ message: 'Link de acesso enviado por e-mail.' });
    }
    const result = await db.rpc('club_command', { p_actor: actor, p_action: action, p_data: payload });
    if (result.error) throw result.error;
    return clubJson(result.data);
  } catch (error) { return clubFailure(error); }
}
