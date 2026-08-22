export function parseInitialAgendaTopics(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidEmailSender(value: string) {
  const trimmed = value.trim();
  const namedAddress = trimmed.match(/<([^<>]+)>$/);
  return isValidEmailAddress(namedAddress?.[1] || trimmed);
}

export function validUniqueRecipients(profiles: Array<{ email?: string | null }>, limit = 50) {
  const recipients = profiles
    .map((profile) => String(profile.email || "").trim().toLowerCase())
    .filter(isValidEmailAddress);
  return [...new Set(recipients)].slice(0, limit);
}
