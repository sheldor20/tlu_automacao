import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmailAddress, isValidEmailSender, parseInitialAgendaTopics, validUniqueRecipients } from "../lib/ra.ts";

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
