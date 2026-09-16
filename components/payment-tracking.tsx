"use client";
import { useEffect, useState } from "react";
import { PaymentDetail } from "./payment-detail";
export function PaymentTracking() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToken(location.hash.slice(1));
    const timer = setTimeout(update, 0);
    window.addEventListener("hashchange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  if (token === null) return <p>Carregando acompanhamento…</p>;
  if (!/^[a-f0-9]{64}$/.test(token))
    return (
      <div className="payment-alert" role="alert">
        Use o link completo recebido no e-mail da sua solicitação para
        acompanhar o pagamento.
      </div>
    );
  return <PaymentDetail trackingToken={token} />;
}
