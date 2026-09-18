export type ClubRole = 'manager' | 'viewer' | 'partner' | 'client';
export type ClubTab = 'offers' | 'partners' | 'vouchers' | 'members' | 'redeem';
export type VoucherState = 'available' | 'used' | 'expired';
export type ClubActor = { role: ClubRole; name: string; partner_id?: string; client_id?: string };
export type ClubStats = { issued: number; used: number; available: number; expired: number };
export type PartnerOption = { id: string; name: string; active: boolean };
export type ClubPartner = PartnerOption & {
  category: string; city: string; contact_email: string; contact_phone: string;
  offers_count: number; issued_count: number; used_count: number;
};
export type ClubOffer = {
  id: string; partner_id: string; partner_name: string; category: string; city: string;
  title: string; benefit: string; description: string; rules: string;
  status: 'draft' | 'active' | 'paused'; display_status: string;
  starts_at: string; ends_at: string; redemption_days: number | null;
  max_issues: number | null; per_client_limit: number; version: number;
  issued_count: number; used_count: number; own_count: number;
};
export type ClubSnapshot = { title: string; benefit: string; rules: string; description: string; partner_name: string };
export type ClubVoucher = {
  id: string; offer_id: string; code?: string | null; snapshot: ClubSnapshot;
  issued_at: string; expires_at: string; redeemed_at: string | null; state?: VoucherState;
};
export type ClubMember = {
  id: string; email: string; kind: 'partner' | 'client'; partner_id: string | null;
  client_id: string | null; active: boolean; owner_name: string;
};
export type ClubData = {
  actor: ClubActor; stats: ClubStats; partners: PartnerOption[];
  items: unknown[]; total: number; page: number; page_size: number;
};
export const CLUB_LABELS: Record<string, string> = {
  active: 'Ativo', inactive: 'Inativo', paused: 'Pausado', draft: 'Rascunho',
  scheduled: 'Agendado', expired: 'Expirado', available: 'Disponível', used: 'Utilizado',
  partner: 'Parceiro', client: 'Cliente',
};
/** Only formatting separators are accepted; punctuation never silently becomes a valid code. */
export function normalizeClubCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}
export function validClubCode(value: string): boolean {
  return /^TLU[0-9A-F]{20}$/.test(normalizeClubCode(value));
}
export function formatClubCode(value: string): string {
  const code = normalizeClubCode(value);
  if (!validClubCode(code)) return value;
  return `TLU-${code.slice(3).match(/.{4}/g)!.join('-')}`;
}
export function voucherState(voucher: Pick<ClubVoucher, 'redeemed_at' | 'expires_at'>, now = Date.now()): VoucherState {
  if (voucher.redeemed_at) return 'used';
  return new Date(voucher.expires_at).getTime() <= now ? 'expired' : 'available';
}
export function usageRate(stats: Pick<ClubStats, 'issued' | 'used'>): number {
  return stats.issued > 0 ? Math.round(stats.used / stats.issued * 1000) / 10 : 0;
}
export function localDateTimeInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
