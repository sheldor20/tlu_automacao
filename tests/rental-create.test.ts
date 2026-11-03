import assert from "node:assert/strict";
import test from "node:test";
import { rentalCreateSchema } from "../lib/rental-create.ts";

const valid = { name: " Casa nova ", qlik_property_id: " 1|009 ", property_address: "Rua das Flores, 10", lessor_type: "pj", lessor_name: "Terra Lótus", property_type: "Imóvel Residencial", rentable: true };
test("cadastro preserva o código exato, incluindo zeros e separadores", () => {
  assert.equal(rentalCreateSchema.parse(valid).qlik_property_id, "1|009");
  assert.equal(rentalCreateSchema.parse({ ...valid, qlik_property_id: "0007" }).qlik_property_id, "0007");
});
test("cadastro rejeita campos inválidos e tentativas de forjar autoria ou confirmação Qlik", () => {
  for (const patch of [{ qlik_property_id: " " }, { qlik_property_id: "-" }, { name: " " }, { property_address: "Rua" }, { rentable: "true" }, { created_by: "other-user" }, { qlik_present: true }, { status: "alugado" }]) {
    assert.equal(rentalCreateSchema.safeParse({ ...valid, ...patch }).success, false);
  }
});
