import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizeClubCode, validClubCode } from './club';

export class ClubError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const uuid = z.string().uuid();
const short = (max: number) => z.string().trim().max(max);
const maybeNumber = (max: number) => z.number().int().min(1).max(max).nullable();
const partnerSchema = z.object({
  id: uuid.optional(), name: short(120).min(2), category: short(80).default('Geral'),
  city: short(100).default(''), contact_email: z.union([z.string().email().max(254), z.literal('')]).default(''),
  contact_phone: short(40).default(''), active: z.boolean(),
});
const offerSchema = z.object({
  id: uuid.optional(), version: z.number().int().positive().optional(), partner_id: uuid,
  title: short(140).min(3), benefit: short(140).min(3), description: short(2000).default(''),
  rules: short(5000).min(5), status: z.enum(['draft', 'active', 'paused']),
  starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }),
  redemption_days: maybeNumber(365), max_issues: maybeNumber(1000000),
  per_client_limit: z.number().int().min(1).max(100),
}).refine(v => new Date(v.ends_at) > new Date(v.starts_at), { message: 'O fim deve ser posterior ao início.' })
  .refine(v => !v.id || !!v.version, { message: 'Atualize a oferta antes de editar.' });
const memberSchema = z.union([
  z.object({ id: uuid, active: z.boolean() }),
  z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
    kind: z.enum(['partner', 'client']), partner_id: uuid.nullable(), client_id: short(200).min(1).nullable(),
  }).refine(v => v.kind === 'partner' ? !!v.partner_id && !v.client_id : !!v.client_id && !v.partner_id,
    { message: 'Vincule o acesso a um parceiro ou cliente.' }),
]);
const codeSchema = z.object({ code: z.string().max(80).refine(validClubCode,
  { message: 'Informe o código completo do cupom.' }).transform(normalizeClubCode) });
export const clubBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('partner'), data: partnerSchema }),
  z.object({ action: z.literal('offer'), data: offerSchema }),
  z.object({ action: z.literal('member'), data: memberSchema }),
  z.object({ action: z.literal('invite'), data: z.object({ id: uuid }) }),
  z.object({ action: z.literal('claim'), data: z.object({ offer_id: uuid, request_id: uuid }) }),
  z.object({ action: z.literal('check'), data: codeSchema }),
  z.object({ action: z.literal('redeem'), data: codeSchema }),
]);
export const clubQuerySchema = z.object({
  tab: z.enum(['offers', 'partners', 'vouchers', 'members', 'clients']).default('offers'),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  q: z.string().max(120).default(''),
  status: z.enum(['all', 'active', 'inactive', 'draft', 'paused', 'scheduled', 'expired', 'used', 'available']).default('all'),
  partner: uuid.optional(),
});
export async function clubServer(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ClubError('Clube temporariamente indisponível.', 503);
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ClubError('Entre no clube para continuar.', 401);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data.user) throw new ClubError('Sua sessão expirou. Entre novamente.', 401);
  return { db, actor: data.user.id };
}
export function clubJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'Vary': 'Authorization',
  } });
}
const errors: Record<string, [string, number]> = {
  club_forbidden: ['Este acesso não está habilitado para essa ação no Clube TLU.', 403],
  club_invalid: ['Revise os campos informados.', 400],
  club_not_found: ['Cupom ou registro não encontrado para este acesso.', 404],
  club_unavailable: ['Parceiro ou desconto indisponível no momento.', 409],
  club_conflict: ['O desconto foi alterado por outra pessoa. Atualize antes de salvar.', 409],
  club_limit_below_issued: ['O limite não pode ser menor que a quantidade já retirada.', 409],
  club_request_conflict: ['Esta retirada já foi registrada para outro desconto.', 409],
  club_sold_out: ['Todos os cupons desse desconto já foram retirados.', 409],
  club_client_limit: ['Você já atingiu o limite de retiradas desse desconto.', 409],
  club_already_used: ['Este cupom já foi utilizado. Não é possível usá-lo novamente.', 409],
  club_expired: ['Este cupom está expirado.', 409],
  club_retry: ['Não foi possível gerar o código. Tente novamente.', 503],
};
export function clubFailure(error: unknown) {
  if (error instanceof ClubError) return clubJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return clubJson({ error: error.issues[0]?.message || 'Revise os campos.' }, 400);
  const detail = error && typeof error === 'object' ? error as { message?: string; code?: string } : {};
  const known = errors[detail.message || ''];
  if (known) return clubJson({ error: known[0] }, known[1]);
  if (detail.code === '23505') return clubJson({ error: 'Este acesso já está cadastrado. Busque-o na aba Acessos.' }, 409);
  if (detail.code === '23503') return clubJson({ error: 'Selecione um parceiro ou cliente cadastrado.' }, 400);
  if (detail.code === '23514') return clubJson({ error: 'Revise as datas, regras e limites informados.' }, 400);
  console.error('Clube TLU operation failed', { code: detail.code || 'unknown' });
  return clubJson({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500);
}
