import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmailAddress, isValidEmailSender, parseInitialAgendaTopics, renderRaMinutesEmail, validUniqueRecipients } from "../lib/ra.ts";

test("converte linhas e bullets em tópicos iniciais limpos", () => {
  assert.deepEqual(parseInitialAgendaTopics("• Orçamento\n- Cronograma\n* Riscos\n1. Próximos passos\n\n"), [
    "Orçamento",
    "Cronograma",
    "Riscos",
    "Próximos passos",
  ]);
});

test("valida remetente simples ou com nome para o Resend", () => {
  assert.equal(isValidEmailSender("projetos@terralotus.com.br"), true);
  assert.equal(isValidEmailSender("Terra Lotus <projetos@terralotus.com.br>"), true);
  assert.equal(isValidEmailSender("Terra Lotus <sem-email>"), false);
});

test("mantém apenas destinatários válidos, únicos e normalizados", () => {
  const profiles = [
    { email: " PESSOA@EXAMPLE.COM " },
    { email: "pessoa@example.com" },
    { email: "invalido" },
    { email: null },
    { email: "outra@example.com" },
  ];
  assert.deepEqual(validUniqueRecipients(profiles), ["pessoa@example.com", "outra@example.com"]);
  assert.equal(isValidEmailAddress("sem-dominio@localhost"), false);
});

test("renderiza a ATA no mesmo card documental da interface", () => {
  const minutes = `ATA – REUNIÃO RA
Data: 20 de agosto de 2026 às 16:00
Líder: Christiane Ribeiro
Participantes: Christiane Ribeiro, Awa Guimarães

PAUTA E REGISTROS
1. Assuntos gerais
   • Pauta da reunião
2. Anápolis – Parceria
   • Sem tópicos registrados.

CATÁLOGO DE DEFINIÇÕES
Nenhuma definição formal registrada.`;
  const html = renderRaMinutesEmail(minutes);

  assert.match(html, /<h1[^>]*>ATA da reunião<\/h1>/);
  assert.match(html, />Registro final da reunião<\/p>/);
  assert.match(html, /border-radius:24px/);
  assert.match(html, /font-family:SFMono-Regular/);
  assert.match(html, /@media only screen and \(max-width: 620px\)/);
  assert.match(html, /PAUTA E REGISTROS/);
  assert.match(html, /Sem tópicos registrados\./);
  assert.match(html, /CATÁLOGO DE DEFINIÇÕES/);
  assert.doesNotMatch(html, /TERRA LÓTUS/);
  assert.doesNotMatch(html, /Ata gerada e enviada pelo TLU Space/);
  assert.doesNotMatch(html, /Reenviar ATA/);
});

test("escapa conteúdo dinâmico da ATA no HTML do e-mail", () => {
  const html = renderRaMinutesEmail('Projeto <script>alert("x")</script> & definição');

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; definição/);
});
