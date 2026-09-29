type Row = Record<string, unknown>;
const STOP = new Set(["para","como","qual","quais","quando","onde","quem","sobre","processo","etapa","etapas","deve","fazer","esse","essa"]);
export function processContext(process: Row, steps: Row[], question: string) {
  const words = [...new Set(question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(word => !STOP.has(word));
  const ranked = steps.map((step, index) => {
    const text = JSON.stringify(step).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return { index, score: words.reduce((n, word) => n + Number(text.includes(word)), 0) };
  }).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.index - b.index);
  const broad = /resum|visão geral|visao geral|todas|todos|completo|começo|inicio|início|fim|sequência|sequencia/i.test(question);
  const selected = new Set<number>();
  if (broad || !ranked.length || steps.length <= 8) steps.forEach((_, index) => selected.add(index));
  else for (const item of ranked.slice(0, 6)) {
    for (const index of [item.index - 1, item.index, item.index + 1]) if (index >= 0 && index < steps.length) selected.add(index);
  }
  return { process, steps: steps.filter((_, index) => selected.has(index)), omitted_steps: steps.length - selected.size };
}
export function directProcessAnswer(question: string, process: Row): string | null {
  if (/^(qual (é |e )?o objetivo(?: (?:deste|desse|do) processo)?|objetivo (deste|desse|do) processo)[? .]*$/i.test(question.trim()) && process.objective) {
    return `Objetivo de ${String(process.title || "processo")}: ${String(process.objective)}`;
  }
  // All other requests retain synthesis; keyword overlap alone is not proof of a complete answer.
  return null;
}

