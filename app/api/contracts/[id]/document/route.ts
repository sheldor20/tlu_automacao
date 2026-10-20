import { contractAccess, contractFailure } from "@/lib/contract-server";
import { contractDocumentText, wordDocument } from "@/lib/contract-document";
import { contractProtocol } from "@/lib/contract-requests";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { row } = await contractAccess(request, (await params).id);
    return new Response(wordDocument(contractDocumentText(row)), { headers: {
      "Content-Type": "application/msword", "Content-Disposition": `attachment; filename="minuta-${contractProtocol(row.protocol)}.doc"`,
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return contractFailure(error); }
}
