import { PAYMENT_STATUSES, paymentEventLabel, paymentProtocol, type PaymentStatus } from "./payment-requests.ts";

type DigestTask = { id: string; title: string; due_date: string; project_name: string; href: string };
type DigestPayment = { request_id: string; protocol: number; title: string; kind: string; status: PaymentStatus; event_count: number };
export type DailyDigest = {
  name: string;
  date: string;
  today_count: number;
  overdue_count: number;
  payment_count: number;
  event_count: number;
  today: DigestTask[];
  overdue: DigestTask[];
  payments: DigestPayment[];
};
export type DigestEmail = { from: string; to: string[]; subject: string; html: string; text: string };

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const dateBr = (value: string) => value.split("-").reverse().join("/");

export function dailyDigestOrigin(env: Record<string, string | undefined>) {
  const configured = env.APP_URL || env.PAYMENT_APP_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!configured) throw new Error("Configure APP_URL com o endereço público do sistema.");
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("APP_URL deve usar HTTPS, sem credenciais.");
  return url.origin;
}

export function buildDailyDigestEmail(digest: DailyDigest, recipient: string, from: string, origin: string): DigestEmail {
  const link = `${origin}/hoje`;
  const hasItems = digest.today_count + digest.overdue_count + digest.payment_count > 0;
  const subject = hasItems ? `Seu resumo de hoje · ${dateBr(digest.date)} · Terra Lótus` : "Comece a usar o Terra Lótus Space";
  const introduction = hasItems
    ? "Confira o que você tem para resolver e as novidades nas solicitações de pagamento."
    : "Você não tem tarefas para hoje, tarefas vencidas ou novas movimentações de pagamento. Comece a usar o Terra Lótus Space para organizar suas atividades e acompanhar suas solicitações em um só lugar.";
  const sections: string[] = [];
  const plain: string[] = [];
  function section(title: string, total: number, items: { title: string; detail: string; url: string }[]) {
    if (!total) return;
    sections.push(`<h2 style="font-size:18px;margin:28px 0 12px">${escape(title)} (${total})</h2><ul style="padding-left:20px">${items.map(item => `<li style="margin-bottom:14px;line-height:1.5"><a href="${escape(item.url)}" style="color:#263329;font-weight:bold">${escape(item.title)}</a><br><span style="color:#637167;font-size:13px">${escape(item.detail)}</span></li>`).join("")}</ul>${total > items.length ? `<p style="font-size:13px;color:#637167">Mais ${total - items.length} no sistema.</p>` : ""}`);
    plain.push(`${title} (${total})`, ...items.map(item => `• ${item.title}\n  ${item.detail}\n  ${item.url}`), ...(total > items.length ? [`Mais ${total - items.length} no sistema.`] : []));
  }
  const taskItems = (tasks: DigestTask[]) => tasks.map(t => ({ title: t.title, detail: `${t.project_name} · Prazo: ${dateBr(t.due_date)}`, url: `${origin}${t.href}` }));
  section("Tarefas vencidas", digest.overdue_count, taskItems(digest.overdue));
  section("Tarefas de hoje", digest.today_count, taskItems(digest.today));
  section("Solicitações de pagamento com movimentação", digest.payment_count, digest.payments.map(p => ({
    title: `${paymentProtocol(p.protocol)} · ${p.title}`,
    detail: `${paymentEventLabel(p.kind, p.status)} · ${PAYMENT_STATUSES[p.status] || p.status} · ${p.event_count} movimentação(ões)`,
    url: `${origin}/pagamentos/${p.request_id}`,
  })));
  const action = hasItems ? "Acessar o sistema" : "Começar a usar";
  return {
    from, to: [recipient], subject,
    text: `Bom dia, ${digest.name}!\n\n${introduction}\n\n${plain.join("\n\n")}\n\n${action}: ${link}\n\nTerra Lótus Space · Resumo de segunda a sexta, às 7h45 (Brasília).`,
    html: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f5f1;font-family:Arial,sans-serif;color:#263329"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;background:white"><tr><td style="background:#263329;color:white;padding:24px 28px"><strong style="font-size:18px;letter-spacing:2px">TERRA LÓTUS</strong><br><span style="font-size:12px">SEU RESUMO DO DIA · ${dateBr(digest.date)}</span></td></tr><tr><td style="padding:28px"><h1 style="font-size:24px;margin:0 0 16px">Bom dia, ${escape(digest.name)}!</h1><p style="line-height:1.6;color:#637167">${escape(introduction)}</p>${sections.join("")}<p style="margin-top:28px"><a href="${escape(link)}" style="display:inline-block;background:#263329;color:white;text-decoration:none;padding:15px 24px;border-radius:8px;font-weight:bold">${action}</a></p><p style="font-size:12px;line-height:1.5;color:#637167">Consulte os detalhes e acompanhe as atualizações no sistema.</p></td></tr><tr><td style="padding:20px 28px;background:#edf1eb;font-size:11px;color:#637167">Resumo de segunda a sexta, às 7h45 (horário de Brasília).<br>Terra Lótus Space</td></tr></table></td></tr></table></body></html>`,
  };
}
