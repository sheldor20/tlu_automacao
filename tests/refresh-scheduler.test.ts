import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshScheduler } from "../lib/refresh-scheduler.ts";

test("focus e visibilidade juntos fazem uma única consulta; mudanças durante a consulta são preservadas", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let finish: () => void = () => {};
  const scheduler = createRefreshScheduler(async () => {
    calls++;
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  scheduler.schedule();
  scheduler.schedule();
  t.mock.timers.tick(100);
  assert.equal(calls, 1);
  scheduler.schedule();
  scheduler.schedule();
  t.mock.timers.tick(100);
  assert.equal(calls, 1, "não há consultas simultâneas");
  finish();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(calls, 2, "atualização que chegou durante a consulta não foi perdida");
  scheduler.schedule();
  scheduler.dispose();
  finish();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(1000);
  assert.equal(calls, 2, "desmontagem cancela atualizações pendentes");
});
