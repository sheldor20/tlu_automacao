import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchInstagramFollowers,
  parseInstagramPublicHtml,
  parseInstagramPublicJson,
} from "../lib/instagram-followers.ts";

test("normaliza a contagem do JSON público do perfil", () => {
  assert.deepEqual(parseInstagramPublicJson({
    data: {
      user: {
        username: "terralotusurbanismo",
        edge_followed_by: { count: 3210 },
      },
    },
  }, "terralotusurbanismo"), {
    username: "terralotusurbanismo",
    followersCount: 3210,
    source: "public-json",
  });
});

test("lê contagens compactas em português nos metadados públicos", () => {
  const html = '<meta property="og:description" content="3,2 mil seguidores, 120 seguindo, 54 publicações">';
  assert.deepEqual(parseInstagramPublicHtml(html, "terralotusurbanismo"), {
    username: "terralotusurbanismo",
    followersCount: 3200,
    source: "public-html",
  });
});

test("lê contagens em inglês nos metadados públicos", () => {
  const html = '<meta name="description" content="3,247 Followers, 120 Following, 54 Posts">';
  assert.equal(parseInstagramPublicHtml(html, "terralotusurbanismo").followersCount, 3247);
});

test("usa outra superfície pública quando a primeira está indisponível", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("web_profile_info")) return new Response("{}", { status: 429 });
    if (url.endsWith("/embed/")) return new Response("", { status: 200 });
    return new Response('<meta property="og:description" content="4.218 seguidores">', { status: 200 });
  }) as typeof fetch;

  const profile = await fetchInstagramFollowers({ fetchImpl });
  assert.equal(profile.followersCount, 4218);
  assert.equal(profile.source, "public-html");
});

test("rejeita páginas que não expõem a contagem", () => {
  assert.throws(
    () => parseInstagramPublicHtml("<html><title>Instagram</title></html>", "terralotusurbanismo"),
    /não expôs a contagem/,
  );
});
