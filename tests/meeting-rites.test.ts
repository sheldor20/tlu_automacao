import assert from "node:assert/strict";
import test from "node:test";
import { defaultRiteDate, meetingRecordLines, MEETING_RITES } from "../lib/meeting-rites.ts";

test("RAE sugere o próximo dia 15 inclusive na virada de mês e ano", () => {
  for (const [input,expected] of [["2026-09-01T10:30:00","2026-09-15"],["2026-09-15T10:30:00","2026-09-15"],["2026-09-28T10:30:00","2026-10-15"],["2026-12-31T10:30:00","2027-01-15"]]) {
    assert.equal(defaultRiteDate("RAE",new Date(input)).slice(0,10),expected);
  }
});
test("ata individual inclui feedbacks, PDI, responsáveis, prazos e acompanhamento", () => {
  const lines=meetingRecordLines("1:1",{leader_feedback:"Avanços",employee_feedback:"Apoio necessário",development:"Curso previsto no PDI",next_steps:"Jessica, até 15/10",follow_up:"Retomar o curso",unknown:"Campo fora do modelo"}).join("\n");
  for(const text of ["Avanços","Apoio necessário","Curso previsto no PDI","Jessica, até 15/10","Retomar o curso"]) assert.ok(lines.includes(text));
  assert.ok(!lines.includes("Campo fora do modelo"));
  assert.equal(MEETING_RITES["1:1"].topics.length,7);
  assert.deepEqual(meetingRecordLines("RA",{}),[]);
});
