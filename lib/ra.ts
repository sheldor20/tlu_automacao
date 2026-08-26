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

function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function renderRaMinutesEmail(minutes: string) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>ATA da reunião</title>
  <style>
    @media only screen and (max-width: 620px) {
      .ra-shell { padding: 12px 8px !important; }
      .ra-card { border-radius: 18px !important; }
      .ra-header-cell { padding: 17px !important; }
      .ra-content-cell { padding: 20px 17px 24px !important; }
      .ra-document { font-size: 14px !important; line-height: 1.6 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f6f5f0;color:#1d241f;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background-color:#f6f5f0;">
    <tr>
      <td class="ra-shell" align="center" style="padding:28px 16px;">
        <table class="ra-card" role="presentation" width="760" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:760px;border:1px solid #e3e7e1;border-collapse:separate;border-spacing:0;border-radius:24px;background-color:#ffffff;box-shadow:0 6px 24px rgba(31,45,34,.06);overflow:hidden;">
          <tr>
            <td class="ra-header-cell" style="padding:18px 22px;border-bottom:1px solid #e3e7e1;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td width="32" valign="top" style="width:32px;padding:1px 10px 0 0;">
                    <span style="display:block;width:18px;height:22px;border:2px solid #263329;border-radius:3px;box-sizing:border-box;padding:6px 3px 0;">
                      <span style="display:block;height:2px;margin-bottom:3px;background-color:#263329;"></span>
                      <span style="display:block;width:8px;height:2px;background-color:#263329;"></span>
                    </span>
                  </td>
                  <td valign="top">
                    <h1 style="margin:0;color:#1d241f;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;line-height:25px;letter-spacing:-.34px;">ATA da reunião</h1>
                    <p style="margin:5px 0 0;color:#6c756e;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:400;line-height:19px;">Registro final da reunião</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="ra-content-cell" style="padding:20px 22px 24px;">
              <pre class="ra-document" style="margin:0;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;color:#3f4842;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,Courier New,monospace;font-size:14px;font-weight:400;line-height:1.65;text-align:left;">${escapeEmailHtml(minutes)}</pre>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
