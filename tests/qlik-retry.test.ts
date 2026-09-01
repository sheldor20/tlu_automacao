import assert from "node:assert/strict";
import test from "node:test";
import { isRecoverableQlikBrowserError } from "../lib/qlik-retry.ts";

test("repete o lote quando a abertura do WebSocket Qlik expira", () => {
  assert.equal(isRecoverableQlikBrowserError(
    new Error("Qlik Engine: tempo esgotado ao abrir o WebSocket."),
  ), true);
  assert.equal(isRecoverableQlikBrowserError(
    new Error("Qlik Engine: não foi possível abrir o WebSocket autenticado."),
  ), true);
  assert.equal(isRecoverableQlikBrowserError(
    new Error("Qlik Engine: a página não abriu uma conexão nativa autenticada."),
  ), true);
});

test("mantém a recuperação de encerramentos transitórios do Chromium", () => {
  assert.equal(isRecoverableQlikBrowserError(new Error("Protocol error: Target closed")), true);
  assert.equal(isRecoverableQlikBrowserError(new Error("Browser has disconnected")), true);
  assert.equal(isRecoverableQlikBrowserError(new Error("TimeoutError: Waiting failed: 120000ms exceeded")), true);
});

test("não repete erros funcionais ou de validação dos indicadores", () => {
  assert.equal(isRecoverableQlikBrowserError(
    new Error("Qlik: as cinco posições de unidades vieram zeradas."),
  ), false);
  assert.equal(isRecoverableQlikBrowserError(new Error("Supabase: permission denied")), false);
});
