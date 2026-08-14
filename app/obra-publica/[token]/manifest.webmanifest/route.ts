import { NextResponse } from "next/server";

const tokenPattern = /^[a-f0-9]{48}$/;

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!tokenPattern.test(token)) return new NextResponse(null, { status: 404 });
  return NextResponse.json({
    name: "Atualização de obra | Terra Lótus",
    short_name: "Obra Terra Lótus",
    description: "Atualização de campo com suporte offline.",
    start_url: `/obra-publica/${token}`,
    scope: `/obra-publica/${token}`,
    display: "standalone",
    background_color: "#f4f2ef",
    theme_color: "#263329",
    orientation: "any",
  }, {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
