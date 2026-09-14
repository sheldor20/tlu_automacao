import assert from "node:assert/strict";
import test from "node:test";
import {
  applySubmissionToSnapshot,
  buildPublicWorkSubmissionFormData,
  isRetryablePublicWorkStatus,
  type PendingPublicWorkSubmission,
  type PublicWorkSnapshot,
} from "../lib/public-work-offline.ts";

const submission = {
  id: "d6f57c30-7995-4ce8-a066-615dbb4eb691",
  token: "a".repeat(48),
  micro_stage_id: "micro-1",
  micro_stage_name: "Fundação",
  progress_percent: 65,
  note: "Concretagem concluída.",
  supplies: [{ name: "Cimento", total_value: 1000, total_quantity: 100, used_quantity: 60 }],
  photo: new Blob(["foto"], { type: "image/jpeg" }),
  photo_name: "obra.jpg",
  photo_type: "image/jpeg",
  base_updated_at: "2026-08-14T12:00:00.000Z",
  created_at: "2026-08-14T13:00:00.000Z",
  attempts: 0,
  last_error: null,
  requires_review: false,
} satisfies PendingPublicWorkSubmission;

const snapshot = {
  construction: { id: "work-1", name: "Obra", address: null, status: "em_andamento", progress_percent: 30, updated_at: "2026-08-14T12:00:00.000Z" },
  stages: [{
    id: "stage-1",
    name: "Estrutura",
    description: null,
    start_date: null,
    end_date: null,
    progress_percent: 30,
    micro_stages: [{
      id: "micro-1",
      name: "Fundação",
      description: null,
      start_date: null,
      end_date: null,
      progress_percent: 20,
      supplies: [],
      updated_at: "2026-08-14T12:00:00.000Z",
    }],
  }],
  plans: [],
} satisfies PublicWorkSnapshot;

test("aplica o avanço e os insumos na cópia offline da obra", () => {
  const updated = applySubmissionToSnapshot(snapshot, submission);
  assert.equal(updated.stages[0].micro_stages[0].progress_percent, 65);
  assert.deepEqual(updated.stages[0].micro_stages[0].supplies, submission.supplies);
  assert.equal(snapshot.stages[0].micro_stages[0].progress_percent, 20);
});

test("monta o mesmo formulário usado pelo envio online e pela fila", () => {
  const body = buildPublicWorkSubmissionFormData(submission);
  assert.equal(body.get("client_submission_id"), submission.id);
  assert.equal(body.get("base_updated_at"), submission.base_updated_at);
  assert.equal(body.get("progress_percent"), "65");
  assert.ok(body.get("photo") instanceof Blob);
});

test("envia vistoria sem foto preservando avanço, comentário, estoque e identificação", () => {
  const withoutPhoto = { ...submission, photo: null, photo_name: "", photo_type: "" };
  const restored = structuredClone(withoutPhoto);
  const body = buildPublicWorkSubmissionFormData(restored);
  assert.equal(body.has("photo"), false);
  assert.equal(body.get("client_submission_id"), submission.id);
  assert.equal(body.get("note"), submission.note);
  assert.deepEqual(JSON.parse(String(body.get("supplies"))), submission.supplies);
  const updated = applySubmissionToSnapshot(snapshot, restored);
  assert.equal(updated.stages[0].micro_stages[0].progress_percent, 65);
  assert.deepEqual(updated.stages[0].micro_stages[0].supplies, submission.supplies);
});

test("envia medição de mapa sem foto mantendo traçado e versão da camada", () => {
  const mapSubmission: PendingPublicWorkSubmission = {
    ...submission,
    photo: null,
    photo_name: "",
    photo_type: "",
    kind: "map",
    map_layer_id: "layer-1",
    map_base_updated_at: submission.base_updated_at,
    map_paths: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
  };
  const body = buildPublicWorkSubmissionFormData(mapSubmission);
  assert.equal(body.has("photo"), false);
  assert.equal(body.get("map_layer_id"), mapSubmission.map_layer_id);
  assert.equal(body.get("map_base_updated_at"), submission.base_updated_at);
  assert.deepEqual(JSON.parse(String(body.get("map_paths"))), mapSubmission.map_paths);
});

test("repete somente falhas temporárias", () => {
  assert.equal(isRetryablePublicWorkStatus(0), true);
  assert.equal(isRetryablePublicWorkStatus(502), true);
  assert.equal(isRetryablePublicWorkStatus(409), false);
  assert.equal(isRetryablePublicWorkStatus(404), false);
});
