import Image from "next/image";
import type { ReactNode } from "react";
export function PublicPaymentShell({ children }: { children: ReactNode }) {
  return (
    <div className="payment-public">
      <header className="payment-public-brand">
        <Image
          src="/logo-terra-lotus.png"
          alt="Terra Lótus Urbanismo"
          width={184}
          height={68}
          priority
        />
        <span>Solicitações de pagamento</span>
      </header>
      <main>{children}</main>
      <footer>Terra Lótus · Atendimento financeiro</footer>
    </div>
  );
}
