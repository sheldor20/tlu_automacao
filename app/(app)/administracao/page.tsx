"use client";

import { Button, Dialog, EmptyState, Field, PageIntro, StatusPill, Toast } from "@/components/ui";
import { DEPARTMENTS, MANAGEMENT_AREAS } from "@/lib/constants";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { DepartmentSlug, ManagementAreaSlug, ProcessPermission, ProfileDepartment, ProfileIndicatorArea, ProfileProjectPermission, ProfileReportingLine, UserProfile } from "@/lib/types";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserRoundCog, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ManagedUser = UserProfile & { departments: DepartmentSlug[]; indicator_areas: ManagementAreaSlug[]; project_permission: Omit<ProfileProjectPermission, "user_id">; process_permission: Omit<ProcessPermission, "user_id">; leader_user_id: string | null };

type AdminForm = {
  full_name: string;
  email: string;
  password: string;
  active: boolean;
  is_admin: boolean;
  departments: DepartmentSlug[];
  indicator_areas: ManagementAreaSlug[];
  project_permission: Omit<ProfileProjectPermission, "user_id">;
  process_permission: Omit<ProcessPermission, "user_id">;
  leader_user_id: string;
};

const emptyForm: AdminForm = {
  full_name: "",
  email: "",
  password: "",
  active: true,
  is_admin: false,
  departments: ["novos-negocios"] as DepartmentSlug[],
  indicator_areas: [] as ManagementAreaSlug[],
  project_permission: { access_scope: "full", allow_files: true, allow_updates: true },
  process_permission: { can_manage: false },
  leader_user_id: "",
};

export default function AdministrationPage() {
  const supabase = getSupabase();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadUsers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [profileResult, accessResult, indicatorAccessResult, projectPermissionResult, processPermissionResult, reportingLineResult] = await Promise.all([
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").is("deleted_at", null).order("full_name"),
      supabase.from("profile_departments").select("user_id,department_slug,access_level"),
      supabase.from("profile_indicator_areas").select("user_id,area"),
      supabase.from("profile_project_permissions").select("user_id,access_scope,allow_files,allow_updates"),
      supabase.from("profile_process_permissions").select("user_id,can_manage"),
      supabase.from("profile_reporting_lines").select("report_user_id,leader_user_id"),
    ]);
    if (profileResult.error || accessResult.error || indicatorAccessResult.error || projectPermissionResult.error || processPermissionResult.error || reportingLineResult.error) {
      setToast({ message: friendlyError(profileResult.error || accessResult.error || indicatorAccessResult.error || projectPermissionResult.error || processPermissionResult.error || reportingLineResult.error), type: "error" });
      setLoading(false);
      return;
    }
    const accesses = (accessResult.data || []) as ProfileDepartment[];
    const indicatorAccesses = (indicatorAccessResult.data || []) as ProfileIndicatorArea[];
    const projectPermissions = (projectPermissionResult.data || []) as ProfileProjectPermission[];
    const processPermissions = (processPermissionResult.data || []) as ProcessPermission[];
    const reportingLines = (reportingLineResult.data || []) as ProfileReportingLine[];
    setUsers(((profileResult.data || []) as UserProfile[]).map((profile) => ({
      ...profile,
      departments: accesses.filter((access) => access.user_id === profile.user_id).map((access) => access.department_slug),
      indicator_areas: indicatorAccesses.filter((access) => access.user_id === profile.user_id).map((access) => access.area),
      project_permission: projectPermissions.find((permission) => permission.user_id === profile.user_id) || { access_scope: "full", allow_files: true, allow_updates: true },
      process_permission: processPermissions.find((permission) => permission.user_id === profile.user_id) || { can_manage: false },
      leader_user_id: reportingLines.find((line) => line.report_user_id === profile.user_id)?.leader_user_id || null,
    })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const metrics = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.active).length,
    admins: users.filter((user) => user.active && user.is_admin).length,
    leaders: new Set(users.map((user) => user.leader_user_id).filter(Boolean)).size,
  }), [users]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(user: ManagedUser) {
    setEditing(user);
    setForm({
      full_name: user.full_name || user.email.split("@")[0],
      email: user.email,
      password: "",
      active: user.active,
      is_admin: user.is_admin,
      departments: user.departments,
      indicator_areas: user.indicator_areas,
      project_permission: {
        access_scope: user.project_permission.access_scope,
        allow_files: user.project_permission.allow_files,
        allow_updates: user.project_permission.allow_updates,
      },
      process_permission: { can_manage: user.process_permission.can_manage },
      leader_user_id: user.leader_user_id || "",
    });
    setDialogOpen(true);
  }

  function toggleDepartment(slug: DepartmentSlug) {
    setForm((current) => ({
      ...current,
      departments: current.departments.includes(slug)
        ? current.departments.filter((item) => item !== slug)
        : [...current.departments, slug],
      indicator_areas: slug === "indicadores"
        ? current.departments.includes(slug) ? [] : MANAGEMENT_AREAS.map((area) => area.slug)
        : current.indicator_areas,
    }));
  }

  function toggleIndicatorArea(slug: ManagementAreaSlug) {
    setForm((current) => ({
      ...current,
      indicator_areas: current.indicator_areas.includes(slug)
        ? current.indicator_areas.filter((item) => item !== slug)
        : [...current.indicator_areas, slug],
    }));
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!form.is_admin && form.active && form.departments.length === 0) {
      setToast({ message: "Selecione ao menos um departamento para o usuário.", type: "error" });
      return;
    }
    if (!form.is_admin && form.active && form.departments.includes("indicadores") && form.indicator_areas.length === 0) {
      setToast({ message: "Selecione ao menos uma visão de Indicadores para o usuário.", type: "error" });
      return;
    }
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setSaving(false);
      return setToast({ message: "Sua sessão expirou. Entre novamente.", type: "error" });
    }

    const response = await fetch("/api/admin/users", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(editing ? {
        user_id: editing.user_id,
        full_name: form.full_name,
        active: form.active,
        is_admin: form.is_admin,
        departments: form.departments,
        indicator_areas: form.indicator_areas,
        project_permission: form.project_permission,
        process_permission: form.process_permission,
        leader_user_id: form.leader_user_id || null,
      } : { ...form, leader_user_id: form.leader_user_id || null }),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setToast({ message: result.error || "Não foi possível salvar o usuário.", type: "error" });

    setDialogOpen(false);
    setToast({ message: editing ? "Acessos do usuário atualizados." : "Usuário criado e liberado no sistema.", type: "success" });
    await loadUsers();
  }

  async function deleteUser(user: ManagedUser) {
    if (!supabase || !window.confirm(`Excluir definitivamente o usuário “${user.full_name || user.email}”?`)) return;
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ user_id: user.user_id }),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setToast({ message: result.error || "Não foi possível excluir o usuário.", type: "error" });
    setToast({ message: "Usuário excluído do sistema.", type: "success" });
    await loadUsers();
  }

  return (
    <>
      <PageIntro
        eyebrow="Sistema · Administração"
        title="Usuários e acessos"
        description="Cadastre usuários e escolha exatamente quais departamentos aparecem para cada pessoa."
        action={<Button onClick={openNew}><Plus size={18} /> Novo usuário</Button>}
      />

      <section className="admin-summary-grid">
        <article><Users size={19} /><div><strong>{metrics.total}</strong><span>usuários cadastrados</span></div></article>
        <article><UserCheck size={19} /><div><strong>{metrics.active}</strong><span>usuários ativos</span></div></article>
        <article><ShieldCheck size={19} /><div><strong>{metrics.admins}</strong><span>administradores ativos</span></div></article>
        <article><UserRoundCog size={19} /><div><strong>{metrics.leaders}</strong><span>líderes diretos</span></div></article>
      </section>

      <section className="content-card admin-users-card">
        <div className="content-card-head"><div><h2>Controle de acesso</h2><p>Administradores veem todos os departamentos; os demais seguem as autorizações abaixo</p></div></div>
        {loading ? (
          <div className="list-loading">Carregando usuários…</div>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={23} />} title="Nenhum usuário encontrado" description="Crie o primeiro acesso para começar a distribuir os departamentos." action={<Button onClick={openNew}><Plus size={17} /> Criar usuário</Button>} />
        ) : (
          <div className="admin-user-list">
            {users.map((user) => (
              <article key={user.user_id} className={!user.active ? "admin-user-inactive" : ""}>
                <div className="admin-user-avatar">{(user.full_name || user.email).slice(0, 2).toUpperCase()}</div>
                <div className="admin-user-identity"><strong>{user.full_name || user.email.split("@")[0]}</strong><span>{user.email}</span></div>
                <div className="admin-user-status"><StatusPill tone={user.active ? "success" : "neutral"}>{user.active ? "Ativo" : "Inativo"}</StatusPill>{user.is_admin ? <StatusPill tone="info">Administrador</StatusPill> : null}</div>
                <div className="admin-user-departments">
                  {user.is_admin ? <span>Todos os departamentos</span> : DEPARTMENTS.map((department) => user.departments.includes(department.slug) ? <span key={department.slug}>{department.name}</span> : null)}
                  {!user.is_admin && user.departments.includes("indicadores") ? <small>{user.indicator_areas.length} de {MANAGEMENT_AREAS.length} visões de Indicadores</small> : null}
                  {!user.is_admin && (user.departments.includes("projetos") || user.departments.includes("governanca")) ? <small>{user.project_permission.access_scope === "full" ? "Gestão dos projetos envolvidos" : "Somente tarefas e subtarefas envolvidas"}</small> : null}
                  {!user.is_admin && user.departments.includes("processos") ? <small>{user.process_permission.can_manage ? "Pode criar e editar processos" : "Somente consulta de processos"}</small> : null}
                  {user.leader_user_id ? <small>Líder: {users.find((candidate) => candidate.user_id === user.leader_user_id)?.full_name || users.find((candidate) => candidate.user_id === user.leader_user_id)?.email || "Usuário"}</small> : null}
                </div>
                <div className="table-actions admin-user-actions"><button className="table-action" onClick={() => openEdit(user)} aria-label={`Editar acessos de ${user.full_name || user.email}`}><Pencil size={16} /></button><button className="table-action danger" onClick={() => void deleteUser(user)} disabled={saving} aria-label={`Excluir ${user.full_name || user.email}`}><Trash2 size={16} /></button></div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar usuário" : "Novo usuário"} description={editing ? "Atualize o status, o perfil administrativo e os departamentos liberados." : "O usuário será criado diretamente no Supabase, sem cadastro público."} wide>
        <form className="form-grid" onSubmit={saveUser}>
          <Field label="Nome completo"><input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} minLength={2} maxLength={140} required /></Field>
          <Field label="E-mail"><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={Boolean(editing)} required /></Field>
          {!editing ? <Field label="Senha temporária" hint="Mínimo de 8 caracteres. Compartilhe por um canal seguro." className="form-span-2"><div className="admin-password-field"><KeyRound size={17} /><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} maxLength={72} autoComplete="new-password" required /></div></Field> : null}

          <div className="admin-toggle-grid form-span-2">
            <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span><strong>Usuário ativo</strong><small>Permite entrar e acessar os departamentos liberados.</small></span></label>
            <label><input type="checkbox" checked={form.is_admin} onChange={(event) => setForm({ ...form, is_admin: event.target.checked })} /><span><strong>Administrador</strong><small>Pode criar usuários e administrar todos os departamentos.</small></span></label>
          </div>

          <Field label="Líder direto" hint="O líder poderá visualizar as tarefas, os projetos e a página Hoje deste usuário." className="form-span-2">
            <select value={form.leader_user_id} onChange={(event) => setForm({ ...form, leader_user_id: event.target.value })}>
              <option value="">Sem líder direto</option>
              {users.filter((user) => user.active && user.user_id !== editing?.user_id).map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email} · {user.email}</option>)}
            </select>
          </Field>

          <fieldset className="department-access-fieldset form-span-2" disabled={form.is_admin || !form.active}>
            <legend>Departamentos autorizados</legend>
            <p>{form.is_admin ? "Administradores já possuem acesso completo." : "Selecione um ou mais departamentos para compor o menu deste usuário."}</p>
            <div className="department-access-grid">
              {DEPARTMENTS.map((department) => (
                <label key={department.slug} className={form.departments.includes(department.slug) ? "selected" : ""}>
                  <input type="checkbox" checked={form.departments.includes(department.slug)} onChange={() => toggleDepartment(department.slug)} />
                  <span>{department.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {form.departments.includes("indicadores") && !form.is_admin && form.active ? (
            <fieldset className="department-access-fieldset indicator-access-fieldset form-span-2">
              <legend>Visões de Indicadores</legend>
              <p>Defina quais telas gerenciais este usuário poderá abrir. Os dados das demais visões também ficam bloqueados no banco.</p>
              <div className="indicator-access-grid">
                {MANAGEMENT_AREAS.map((area) => (
                  <label key={area.slug} className={form.indicator_areas.includes(area.slug) ? "selected" : ""}>
                    <input type="checkbox" checked={form.indicator_areas.includes(area.slug)} onChange={() => toggleIndicatorArea(area.slug)} />
                    <span>{area.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {(form.departments.includes("projetos") || form.departments.includes("governanca")) && !form.is_admin && form.active ? (
            <fieldset className="department-access-fieldset project-access-fieldset form-span-2">
              <legend>Acesso a Projetos e Governança</legend>
              <p>Escolha o alcance das tarefas e subtarefas e se arquivos e atualizações ficam disponíveis.</p>
              <div className="admin-toggle-grid">
                <label><input type="radio" name="project-scope" checked={form.project_permission.access_scope === "full"} onChange={() => setForm({ ...form, project_permission: { ...form.project_permission, access_scope: "full" } })} /><span><strong>Gestão completa</strong><small>Administra integralmente apenas os projetos em que está envolvido.</small></span></label>
                <label><input type="radio" name="project-scope" checked={form.project_permission.access_scope === "assigned_tasks"} onChange={() => setForm({ ...form, project_permission: { ...form.project_permission, access_scope: "assigned_tasks" } })} /><span><strong>Somente envolvimento</strong><small>Visualiza projetos envolvidos e apenas as tarefas e subtarefas atribuídas.</small></span></label>
                <label><input type="checkbox" checked={form.project_permission.allow_files} onChange={(event) => setForm({ ...form, project_permission: { ...form.project_permission, allow_files: event.target.checked } })} /><span><strong>Liberar arquivos</strong><small>Permite consultar e enviar arquivos nos projetos visíveis.</small></span></label>
                <label><input type="checkbox" checked={form.project_permission.allow_updates} onChange={(event) => setForm({ ...form, project_permission: { ...form.project_permission, allow_updates: event.target.checked } })} /><span><strong>Liberar atualizações</strong><small>Permite consultar e registrar comentários e atualizações.</small></span></label>
              </div>
            </fieldset>
          ) : null}

          {form.departments.includes("processos") && !form.is_admin && form.active ? (
            <fieldset className="department-access-fieldset project-access-fieldset form-span-2">
              <legend>Permissão de Processos</legend>
              <p>Todos podem consultar e usar o chat. Libere abaixo somente quem poderá criar, editar e publicar fluxos.</p>
              <div className="admin-toggle-grid">
                <label><input type="checkbox" checked={form.process_permission.can_manage} onChange={(event) => setForm({ ...form, process_permission: { can_manage: event.target.checked } })} /><span><strong>Criar e editar processos</strong><small>Permite administrar regras, políticas, etapas e publicação.</small></span></label>
              </div>
            </fieldset>
          ) : null}

          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>{editing ? "Salvar acessos" : "Criar usuário"}</Button></div>
        </form>
      </Dialog>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
