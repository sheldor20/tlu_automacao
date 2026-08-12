const QLIK_ACCOUNT_ACTIONS = [
  "log in with qlik",
  "sign in with qlik",
  "continue with qlik",
  "entrar com qlik",
  "continuar com qlik",
];

export function normalizeLoginAction(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

export function isQlikAccountGatewayAction(value: string) {
  const normalized = normalizeLoginAction(value);
  if (!normalized || normalized.includes("sso")) return false;
  return normalized.includes("qlik account")
    || QLIK_ACCOUNT_ACTIONS.some((action) => normalized === action || normalized.startsWith(`${action} `));
}
