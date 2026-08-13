import assert from "node:assert/strict";
import test from "node:test";
import { extractQlikAppId, isQlikAppWebSocketUrl } from "../lib/qlik-engine.ts";

test("extrai o identificador do aplicativo da URL do Qlik", () => {
  assert.equal(
    extractQlikAppId("https://tenant.us.qlikcloud.com/sense/app/ce523abd-dce7-40f5-bd1c-93a23ffa4faa/sheet/abc"),
    "ce523abd-dce7-40f5-bd1c-93a23ffa4faa",
  );
});

test("falha quando a URL não identifica um aplicativo", () => {
  assert.throws(() => extractQlikAppId("https://tenant.us.qlikcloud.com/analytics/catalog"));
});

test("reconhece a conexão nativa do aplicativo mesmo com identidade de sessão", () => {
  assert.equal(
    isQlikAppWebSocketUrl(
      "wss://tenant.us.qlikcloud.com/app/ce523abd-dce7-40f5-bd1c-93a23ffa4faa/identity/abc123",
      "ce523abd-dce7-40f5-bd1c-93a23ffa4faa",
    ),
    true,
  );
});

test("ignora conexões de outro aplicativo ou que não sejam seguras", () => {
  assert.equal(isQlikAppWebSocketUrl("wss://tenant.us.qlikcloud.com/app/outro", "esperado"), false);
  assert.equal(isQlikAppWebSocketUrl("ws://tenant.us.qlikcloud.com/app/esperado", "esperado"), false);
});
