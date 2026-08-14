import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Atualização de obra | Terra Lótus",
    description: "Atualização de etapas, insumos e evidências da obra, inclusive sem conexão.",
    manifest: `/obra-publica/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Obra Terra Lótus", statusBarStyle: "black-translucent" },
    robots: { index: false, follow: false },
  };
}

export default function PublicWorkLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
