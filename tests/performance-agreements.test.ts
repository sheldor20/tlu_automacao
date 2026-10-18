import assert from "node:assert/strict";
import test from "node:test";
import { performanceAgreementSchema } from "../lib/performance-agreements.ts";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const employee = "11111111-1111-4111-8111-111111111111";
const leader = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const admin = "44444444-4444-4444-8444-444444444444";
const nextLeader = "55555555-5555-4555-8555-555555555555";
const peer = "66666666-6666-4666-8666-666666666666";
const input = {
  report_user_id: employee, cycle: "2026 — 2º semestre", starts_on: "2026-07-01", ends_on: "2026-12-31", expectations: "Alinhamento do ciclo",
  goals: [{ title: "Entregar projeto", indicator: "Projetos concluídos", expected_result: "1 projeto", due_date: "2026-12-20" }],
};

test("valida período, metas e prazos antes do envio", () => {
  assert.equal(performanceAgreementSchema.safeParse(input).success, true);
  assert.equal(performanceAgreementSchema.safeParse({ ...input, ends_on: "2026-01-01" }).success, false);
  assert.equal(performanceAgreementSchema.safeParse({ ...input, goals: [] }).success, false);
  assert.equal(performanceAgreementSchema.safeParse({ ...input, goals: [{ ...input.goals[0], due_date: "2027-01-01" }] }).success, false);
  assert.equal(performanceAgreementSchema.safeParse({ ...input, goals: [{ ...input.goals[0], indicator: "   " }] }).success, false);
});

test("acordos persistem por ciclo e ficam restritos ao colaborador e líder atual", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20261016183946_performance_agreements.sql");
  for (const id of [employee, leader, other, admin, nextLeader, peer]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(0, 3)}@example.test`]);
  }
  await db.query("update public.profiles set is_admin = true where user_id = $1", [admin]);
  await db.query("insert into public.profile_reporting_lines (report_user_id, leader_user_id) values ($1, $2), ($3, $2), ($2, $4)", [employee, leader, peer, other]);

  async function asUser<T>(id: string, work: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  async function create(owner = employee, cycle = input.cycle, goals: unknown = input.goals) {
    return db.query<{ id: string; version: number; created_by: string; updated_by: string }>(
      `insert into public.performance_agreements (report_user_id, cycle, starts_on, ends_on, expectations, goals)
       values ($1, $2, $3, $4, $5, $6::jsonb) returning id, version, created_by, updated_by`,
      [owner, cycle, input.starts_on, input.ends_on, input.expectations, JSON.stringify(goals)],
    );
  }
  const saved = await asUser(employee, () => create());
  const id = saved.rows[0].id;

  await t.test("salva o acordo completo e reabre no banco", async () => {
    assert.equal(saved.rows[0].created_by, employee);
    assert.equal(saved.rows[0].version, 1);
    await asUser(employee, async () => {
      const result = await db.query("select cycle, goals, expectations from public.performance_agreements where id = $1", [id]);
      assert.deepEqual(result.rows, [{ cycle: input.cycle, goals: input.goals, expectations: input.expectations }]);
    });
  });
  await t.test("líder direto lê e edita sem permissão de departamento", async () => {
    await asUser(leader, async () => {
      const result = await db.query("update public.performance_agreements set expectations = 'Ajustado com o líder' where id = $1 and version = 1 returning version, updated_by", [id]);
      assert.deepEqual(result.rows, [{ version: 2, updated_by: leader }]);
      assert.equal((await create(peer)).rows.length, 1);
    });
  });
  await t.test("impede sobrescrita de revisão desatualizada", async () => {
    await asUser(employee, async () => {
      const result = await db.query("update public.performance_agreements set expectations = 'Desatualizado' where id = $1 and version = 1 returning id", [id]);
      assert.equal(result.rows.length, 0);
    });
  });
  for (const [label, user] of [["outro usuário e líder indireto", other], ["administrador", admin], ["colega da mesma equipe", peer]] as const) {
    await t.test(`${label} não lê, altera ou cria acordo de terceiros`, async () => {
      await asUser(user, async () => {
        assert.equal((await db.query("select id from public.performance_agreements where id = $1", [id])).rows.length, 0);
        assert.equal((await db.query("update public.performance_agreements set cycle = 'Inválido' where id = $1 returning id", [id])).rows.length, 0);
        await assert.rejects(() => create(employee, "Não autorizado"), /row-level security/);
      });
    });
  }
  await t.test("colaborador vê somente os próprios acordos", async () => {
    await asUser(employee, async () => {
      const result = await db.query("select report_user_id from public.performance_agreements");
      assert.deepEqual(result.rows, [{ report_user_id: employee }]);
    });
  });
  await t.test("não permite transferir acordo nem falsificar autoria", async () => {
    await asUser(leader, async () => {
      await assert.rejects(() => db.query("update public.performance_agreements set report_user_id = $1 where id = $2", [peer, id]), /identity_immutable/);
      await assert.rejects(() => db.query("update public.performance_agreements set created_by = $1 where id = $2", [leader, id]), /identity_immutable/);
      const result = await db.query("update public.performance_agreements set updated_by = $1, version = 100 where id = $2 returning updated_by, version", [other, id]);
      assert.deepEqual(result.rows, [{ updated_by: leader, version: 3 }]);
    });
  });
  await t.test("mantém um registro por colaborador/ciclo, normalizando espaços e caixa", async () => {
    await asUser(employee, async () => {
      await assert.rejects(() => create(employee, ` ${input.cycle.toUpperCase()} `), /performance_agreements_cycle_key/);
      assert.equal((await create(employee, "2027 — 1º semestre")).rows.length, 1);
    });
  });
  await t.test("rejeita metas inválidas também em gravações diretas", async () => {
    await asUser(employee, async () => {
      for (const goals of [[], {}, null, [null], [{ title: "Meta" }], [{ ...input.goals[0], due_date: "2027-01-01" }], [{ ...input.goals[0], indicator: " " }]]) {
        await assert.rejects(() => create(employee, "Inválido", goals), /performance_agreement_invalid/);
      }
      await assert.rejects(() => db.query("update public.performance_agreements set ends_on = '2026-01-01' where id = $1", [id]));
    });
  });
  await t.test("troca do líder revoga o anterior e permite o atual", async () => {
    await db.query("update public.profile_reporting_lines set leader_user_id = $1 where report_user_id = $2", [nextLeader, employee]);
    await asUser(leader, async () => {
      assert.equal((await db.query("select id from public.performance_agreements where id = $1", [id])).rows.length, 0);
      assert.equal((await db.query("update public.performance_agreements set expectations = 'Antigo líder' where id = $1 returning id", [id])).rows.length, 0);
    });
    for (const user of [employee, nextLeader]) await asUser(user, async () => {
      assert.equal((await db.query("select id from public.performance_agreements where id = $1", [id])).rows.length, 1);
    });
  });
  await t.test("inativação revoga acesso mesmo com sessão autenticada", async () => {
    await db.query("update public.profiles set active = false where user_id = $1", [nextLeader]);
    await asUser(nextLeader, async () => {
      assert.equal((await db.query("select id from public.performance_agreements")).rows.length, 0);
      await assert.rejects(() => create(employee, "Sem acesso"), /row-level security/);
    });
    await db.query("update public.profiles set active = false where user_id = $1", [employee]);
    await asUser(employee, async () => {
      assert.equal((await db.query("select id from public.performance_agreements")).rows.length, 0);
    });
  });
  await t.test("não permite exclusão nem acesso anônimo", async () => {
    await asUser(employee, async () => {
      await assert.rejects(() => db.query("delete from public.performance_agreements where id = $1", [id]), /permission denied/);
    });
    await db.exec("set role anon");
    try {
      await assert.rejects(() => db.query("select * from public.performance_agreements"), /permission denied/);
      await assert.rejects(() => db.query("select public.can_access_performance_agreement($1)", [employee]), /permission denied/);
    } finally { await db.exec("reset role"); }
  });
});
