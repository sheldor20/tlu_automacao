import assert from "node:assert/strict";
import test from "node:test";
import { parseInstagramProfile } from "../lib/instagram-followers.ts";

test("normaliza a contagem agregada de seguidores", () => {
  assert.deepEqual(parseInstagramProfile({
    id: "17841400000000000",
    username: "terralotusurbanismo",
    followers_count: 3210,
  }), {
    id: "17841400000000000",
    username: "terralotusurbanismo",
    followersCount: 3210,
  });
});

test("rejeita respostas sem uma contagem válida", () => {
  assert.throws(
    () => parseInstagramProfile({ id: "1", username: "terralotusurbanismo" }),
    /contagem de seguidores não encontrados/,
  );
});
