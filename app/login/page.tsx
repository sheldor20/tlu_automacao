"use client";

import { Button, Field } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const supabase = getSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/novos-negocios");
    });
  }, [router, supabase]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setError("Conecte as variáveis do Supabase no Vercel antes de entrar.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) {
      setError(friendlyError(authError));
      setLoading(false);
      return;
    }
    router.replace("/novos-negocios");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand-content">
          <Image
            src="/logo-terra-lotus.png"
            alt="Terra Lótus Urbanismo"
            width={260}
            height={96}
            priority
          />
          <div className="login-message">
            <span>Gestão integrada</span>
            <h1>Decisões claras.<br />Projetos em movimento.</h1>
            <p>
              Novos negócios, obras e projetos acompanhados em um só lugar.
            </p>
          </div>
        </div>
        <div className="login-grid" aria-hidden="true" />
        <div className="login-orb login-orb-one" aria-hidden="true" />
        <div className="login-orb login-orb-two" aria-hidden="true" />
      </section>

      <section className="login-form-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-icon"><LockKeyhole size={24} /></div>
          <span className="eyebrow">Acesso seguro</span>
          <h2>Bem-vindo</h2>
          <p className="login-subtitle">Entre com o usuário criado no Supabase.</p>

          <div className="form-stack">
            <Field label="E-mail">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@terralotus.com.br"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Senha">
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </Field>
          </div>

          {error ? <div className="form-alert">{error}</div> : null}

          <Button type="submit" loading={loading} className="login-button">
            Entrar no sistema
          </Button>

          <small className="login-help">
            Não há cadastro público. Solicite acesso ao administrador da Terra Lótus.
          </small>
        </form>
      </section>
    </main>
  );
}
