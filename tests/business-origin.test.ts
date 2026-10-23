import assert from "node:assert/strict";
import test from "node:test";
import { businessOriginDestination } from "../lib/business-origin.ts";

test("origem abre o negócio exato em sua carteira sem escolher vínculo", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(businessOriginDestination(id, "obra"), `/novos-negocios/esteira-de-negocios?business=${id}`);
  assert.equal(businessOriginDestination(id, "contrato"), `/novos-negocios/prospeccao?business=${id}`);
  assert.equal(businessOriginDestination(id, "aguardando"), `/novos-negocios/landing-bank?business=${id}`);
  assert.equal(businessOriginDestination(id, "unknown"), null);
});
