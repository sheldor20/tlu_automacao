import assert from "node:assert/strict";
import test from "node:test";
import { isQlikAccountGatewayAction } from "../lib/qlik-login.ts";

test("reconhece somente uma etapa intermediária da conta Qlik", () => {
  assert.equal(isQlikAccountGatewayAction("Log in with Qlik"), true);
  assert.equal(isQlikAccountGatewayAction("Continuar com Qlik Account"), true);
});

test("não confunde SSO nem o envio do formulário com gateway", () => {
  assert.equal(isQlikAccountGatewayAction("Entrar com SSO"), false);
  assert.equal(isQlikAccountGatewayAction("Log in"), false);
  assert.equal(isQlikAccountGatewayAction("Enviar"), false);
  assert.equal(isQlikAccountGatewayAction("Esqueci meu endereço de e-mail"), false);
});
