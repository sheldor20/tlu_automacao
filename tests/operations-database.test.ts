import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
test("operações: migração, integridade empresa/obra, concorrência e isolamento de acesso", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  for (const migration of [
    "20260916132107_enterprise_performance.sql",
    "20260916180238_payment_requests.sql",
    "20260916180335_payment_access_policies.sql",
    "20260916180924_payment_email_order.sql",
    "20260916192138_payment_finalized_status.sql",
    "20260916194044_payment_materials_optional_fields.sql",
    "20260916203112_payment_edit_delete.sql",
    "20260917133227_finance_clients_collections.sql",
    "20260917133652_operations_source_catalog.sql",
    "20260917133845_operations_catalog_publish_guard.sql",
    "20260917134314_operations_import_timeout.sql",
    "20260917134801_operations_batched_ingestion.sql",
    "20260917135639_operations_collection_classification.sql",
    "20260917140638_operations_compact_ingestion.sql",
    "20260917143529_operations_resumable_imports.sql",
    "20260917145001_operations_initial_publish_budget.sql",
    "20260917145843_operations_publication_scan.sql",
    "20260917151438_operations_read_performance.sql",
    "20260917162639_operations_initial_activation.sql",
    "20260917163239_operations_collection_index.sql",
    "20260917164123_operations_overdue_dates.sql",
  ])
    await migrate(db, migration);
  const admin = "11111111-1111-4111-8111-111111111111",
    viewer = "22222222-2222-4222-8222-222222222222";
  for (const id of [admin, viewer])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      id + "@example.test",
    ]);
  await db.query("update profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from profile_departments");
  await db.exec("insert into operational_publications(kind) values('received'),('receivable'),('paid'),('payable')");
  await db.query(
    "insert into profile_departments(user_id,department_slug) values($1,'clientes')",
    [viewer],
  );
  await db.exec(
    "insert into qlik_companies(id,name,company_key) values('1','Empresa A','Empresa A'),('2','Empresa B','Empresa B');insert into qlik_works(key,company_id,work_id,name) values('w1','1','001','Obra A'),('w2','2','001','Obra B');insert into client_accounts(id,name) values('c1','Cliente');insert into client_contracts(id,client_id,company_id,work_key,contract_number) values('v1','c1','1','w1','1');insert into operational_cash_entries(id,company_id,work_key,contract_id,kind,cash_date,amount) values('r1','1','w1','v1','received','2026-09-17',100),('p1','1','w1',null,'payable','2026-09-17',999);",
  );
  await t.test(
    "cliente não lê despesas de fornecedores nem escreve pela API de dados",
    async () => {
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: viewer, role: "authenticated" }),
      ]);
      await db.exec("set role authenticated");
      try {
        assert.equal(
          (await db.query("select * from client_accounts")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select * from operational_cash_entries")).rows
            .length,
          1,
        );
        await assert.rejects(
          () =>
            db.exec("insert into client_accounts(id,name) values('bad','bad')"),
          /permission denied/,
        );
        await assert.rejects(
          () => db.exec("select save_collection_case('{}',null)"),
          /permission denied/,
        );
      } finally {
        await db.exec("reset role");
      }
    },
  );
  await t.test("anônimo não acessa clientes nem parcelas", async () => {
    await db.exec("set role anon");
    try {
      await assert.rejects(
        () => db.exec("select * from client_accounts"),
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  });
  await t.test(
    "prioriza atrasos pelo histórico sem inventar situação jurídica",
    async () => {
      await db.exec(
        "insert into operational_cash_entries(id,company_id,work_key,contract_id,kind,cash_date,amount) values('late','1','w1','v1','receivable',current_date-2,100); update operational_cash_entries set cash_date=current_date-1 where id='r1';",
      );
      try {
        const row = await db.query<{ collection_group: string }>(
          "select collection_group from collection_worklist where id='v1'",
        );
        assert.equal(row.rows[0].collection_group, "easy");
        assert.equal(
          (await db.query("select * from collection_cases")).rows.length,
          0,
        );
      } finally {
        await db.exec(
          "delete from operational_cash_entries where id='late'; update operational_cash_entries set cash_date='2026-09-17' where id='r1';",
        );
      }
    },
  );
  await t.test(
    "retoma a mesma preparação e impede duas etapas simultâneas",
    async () => {
      const run = (
        await db.query<{ id: string }>(
          "select begin_operational_import('received') as id",
        )
      ).rows[0].id;
      await assert.rejects(
        () => db.query("select begin_operational_import('received')"),
        /import_busy/,
      );
      const entry = {
        id: "resume-entry",
        company_id: "1",
        work_key: "w1",
        contract_id: "v1",
        kind: "received",
        amount: 12.345678,
        description: "Parcela",
      };
      await db.query("select stage_operational_entries($1,$2)", [
        run,
        [{ entity: "entries", id: entry.id, data: entry }],
      ]);
      await db.query(
        "update operational_imports set continuation_ready=true where id=$1",
        [run],
      );
      const resumed = (
        await db.query<{ id: string }>(
          "select begin_operational_import('received') as id",
        )
      ).rows[0].id;
      assert.equal(resumed, run);
      const progress = (
        await db.query<{ rows: number; total: string }>(
          "select * from operational_import_progress($1)",
          [run],
        )
      ).rows[0];
      assert.equal(Number(progress.rows), 1);
      assert.equal(progress.total, "12.345678");
      await db.query(
        "update operational_imports set lease_started_at=now()-interval '16 minutes' where id=$1",
        [run],
      );
      assert.equal(
        (
          await db.query<{ id: string }>(
            "select begin_operational_import('received') as id",
          )
        ).rows[0].id,
        run,
      );
      await db.query(
        "update operational_imports set status='error' where id=$1",
        [run],
      );
    },
  );
  const data = {
    contract_id: "v1",
    version: 0,
    responsible_user_id: admin,
    legal_status: "extrajudicial",
    next_action: "Conferir baixa",
    next_action_date: "2026-09-18",
    last_contact_at: null,
    promise_date: "2026-09-17",
    promise_amount: 100,
    promise_status: "fulfilled",
    receipt_entry_id: "r1",
    notes: "",
  };
  await t.test(
    "promessa só é confirmada com baixa válida e preserva histórico",
    async () => {
      await db.query("select save_collection_case($1,$2)", [data, admin]);
      assert.equal(
        (await db.query("select * from client_events")).rows.length,
        1,
      );
      await assert.rejects(
        () => db.query("select save_collection_case($1,$2)", [data, admin]),
        /collection_conflict/,
      );
      await assert.rejects(
        () =>
          db.query("select save_collection_case($1,$2)", [
            { ...data, version: 1, receipt_entry_id: "p1" },
            admin,
          ]),
        /receipt_invalid/,
      );
    },
  );
  await t.test("pagamento rejeita obra de outra empresa", async () => {
    await assert.rejects(
      () =>
        db.query(
          `insert into payment_requests(submission_id,submission_digest,requester_name,requester_email,company_key,company_name,qlik_work_key,type,title,description,amount,due_date,beneficiary,details,source) values(gen_random_uuid(),'test','Pessoa','test@example.test','Empresa A','Empresa A','w2','bills','Conta','Conta',100,'2026-09-18','{}','{}','internal')`,
        ),
      /payment_work_company_mismatch/,
    );
  });
  await t.test(
    "carga incompleta não substitui dados e publicação validada é atômica",
    async () => {
      const r = (
        await db.query<{ id: string }>(
          "select begin_operational_import('payable') as id",
        )
      ).rows[0].id;
      const entry = {
        id: "new-payable",
        company_id: "1",
        work_key: "w1",
        kind: "payable",
        title_key: "new",
        cash_date: "2026-10-01",
        amount: 200.123456,
        description: "Título",
      };
      await db.query(
        "insert into operational_import_rows(run_id,entity,id,data) values($1,'entries',$2,$3)",
        [r, entry.id, entry],
      );
      await assert.rejects(
        () =>
          db.query("select publish_operational_import($1,2,200.123456)", [r]),
        /import_not_reconciled/,
      );
      assert.equal(
        (
          await db.query<{ active: boolean }>(
            "select active from operational_cash_entries where id='p1'",
          )
        ).rows[0].active,
        true,
      );
      await db.query("delete from operational_import_rows where run_id=$1", [
        r,
      ]);
      await db.query("select stage_operational_entries($1,$2)", [
        r,
        [{ entity: "entries", id: entry.id, data: entry }],
      ]);
      await db.query("select stage_operational_entries($1,$2)", [
        r,
        [{ entity: "entries", id: entry.id, data: entry }],
      ]);
      const audit = await db.query<{ data: Record<string, unknown> }>(
        "select data from operational_import_rows where run_id=$1 and entity='entries'",
        [r],
      );
      assert.deepEqual(audit.rows[0].data, {
        kind: "payable",
        amount: 200.123456,
      });
      await db.query("select publish_operational_import($1,1,200.123456)", [r]);
      assert.equal(
        (
          await db.query<{ active: boolean }>(
            "select active from operational_cash_entries where id='p1'",
          )
        ).rows[0].active,
        false,
      );
      assert.equal(
        (
          await db.query<{ amount: string }>(
            "select amount from operational_cash_entries where id='new-payable'",
          )
        ).rows[0].amount,
        "200.123456",
      );
      assert.equal(
        (
          await db.query(
            "select * from operational_import_rows where run_id=$1",
            [r],
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test("preparação inicial retomável só fica visível após publicar tudo", async () => {
    await db.exec("delete from operational_publications where kind='received'");
    const run = (await db.query<{id:string}>("select begin_operational_import('received') id")).rows[0].id;
    await db.query("select stage_operational_entries($1,$2)", [run, [50,60].map((amount,i)=>({entity:"entries",id:`first-${i}`,data:{id:`first-${i}`,company_id:"1",work_key:"w1",contract_id:"v1",kind:"received",cash_date:"2026-09-17",amount}}))]);
    await db.query("update operational_imports set row_count=2,source_rows=2,total=110,source_total=110 where id=$1",[run]);
    assert.equal((await db.query<{ready:boolean}>("select prepare_initial_operational_publication($1,1) ready",[run])).rows[0].ready,false);
    await assert.rejects(()=>db.query("select publish_operational_import($1,2,110)",[run]),/initial_activation_pending/);
    await assert.rejects(()=>db.query("select save_collection_case($1,$2)",[{...data,version:1,promise_amount:40,receipt_entry_id:"first-0"},admin]),/receipt_invalid/);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:viewer,role:"authenticated"})]);
    await db.exec("set role authenticated");
    try { assert.equal((await db.query("select id from operational_cash_entries where kind='received' and active")).rows.length,0); }
    finally { await db.exec("reset role"); }
    await db.query("select prepare_initial_operational_publication($1,1)",[run]);
    assert.equal((await db.query<{ready:boolean}>("select prepare_initial_operational_publication($1,1) ready",[run])).rows[0].ready,true);
    await db.query("select publish_operational_import($1,2,110)",[run]);
    await db.exec("set role authenticated");
    try { assert.equal((await db.query("select id from operational_cash_entries where kind='received' and active")).rows.length,2); }
    finally { await db.exec("reset role"); }
  });
});
