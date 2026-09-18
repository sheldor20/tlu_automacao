import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClubCode, normalizeClubCode, validClubCode, voucherState, usageRate, localDateTimeInput } from '../lib/club.ts';
const raw = 'TLU0123456789ABCDEF0123';
test('formats all 80 random bits without changing the code', () => {
  assert.equal(formatClubCode(raw), 'TLU-0123-4567-89AB-CDEF-0123');
  assert.equal(normalizeClubCode(formatClubCode(raw)), raw);
});
test('accepts lowercase, separators and pasted whitespace', () => {
  assert.equal(normalizeClubCode(' tlu-0123-4567-89ab-cdef-0123\n'), raw);
  assert.equal(validClubCode(' tlu-0123-4567-89ab-cdef-0123\n'), true);
});
test('rejects prefixes, incomplete tokens, punctuation and nonhex characters', () => {
  for (const input of ['', 'TLU', raw.slice(0, -1), raw + '0', raw + '!', 'XX' + raw, raw.replace('A', 'G')]) {
    assert.equal(validClubCode(input), false, input);
  }
});
test('malformed tokens are not disguised by formatting', () => {
  assert.equal(formatClubCode('TLU-123!'), 'TLU-123!');
});
test('unused coupon is available strictly before expiry', () => {
  assert.equal(voucherState({ expires_at: '2026-09-20T10:00:00Z', redeemed_at: null }, Date.parse('2026-09-20T09:59:59Z')), 'available');
});
test('expiry boundary is inclusive', () => {
  assert.equal(voucherState({ expires_at: '2026-09-20T10:00:00Z', redeemed_at: null }, Date.parse('2026-09-20T10:00:00Z')), 'expired');
});
test('used remains used after the original expiry date', () => {
  assert.equal(voucherState({ expires_at: '2026-09-20T10:00:00Z', redeemed_at: '2026-09-19T10:00:00Z' }, Date.parse('2026-10-20T10:00:00Z')), 'used');
});
test('usage conversion handles empty and nonempty histories', () => {
  assert.equal(usageRate({ issued: 0, used: 0 }), 0);
  assert.equal(usageRate({ issued: 3, used: 1 }), 33.3);
  assert.equal(usageRate({ issued: 4, used: 4 }), 100);
});
test('date input rejects invalid timestamps and respects local display', () => {
  assert.equal(localDateTimeInput('invalid'), '');
  const value = '2026-09-20T10:05:00Z';
  assert.equal(new Date(localDateTimeInput(value)).getTime(), Date.parse(value));
});
