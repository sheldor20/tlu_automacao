export const MEETING_TYPES = ["RAE", "RASP", "RA", "RAO", "1:1"] as const;
export type MeetingType = typeof MEETING_TYPES[number];
export type CollectiveMeetingType = Exclude<MeetingType, "1:1">;
export type MeetingRecord = Record<string, string>;
export type MeetingTypeMember = { meeting_type: CollectiveMeetingType; user_id: string };

type Rite = {
  name: string;
  cadence: string;
  objective: string;
  topics: string[];
  fields: { key: string; label: string; hint: string }[];
};

const nextSteps = { key: "next_steps", label: "Compromissos e próximos passos", hint: "Registre as ações, os responsáveis e os prazos. Os assuntos da pauta também podem virar tarefas." };
export const MEETING_RITES: Record<MeetingType, Rite> = {
  RAE: {
    name: "Reunião de Análise da Estratégia", cadence: "Mensal · dia 15",
    objective: "Analisar a execução da estratégia, os indicadores e o desempenho em relação aos objetivos e metas da Terra Lótus.",
    topics: ["Apresentação e análise dos indicadores", "Acompanhamento dos objetivos e metas estratégicas", "Avaliação dos resultados do período", "Desvios, riscos e oportunidades", "Direcionamentos estratégicos", "Decisões e respectivos responsáveis"],
    fields: [
      { key: "indicators", label: "Indicadores, objetivos e metas", hint: "Compare os resultados do período com as metas estabelecidas." },
      { key: "risks", label: "Desvios, riscos e oportunidades", hint: "Registre os pontos que exigem atenção da gestão." },
      { key: "directions", label: "Direcionamentos estratégicos", hint: "Registre as decisões e seus responsáveis." }, nextSteps,
    ],
  },
  RASP: {
    name: "Reunião de Acompanhamento Estratégico de Projetos", cadence: "Quinzenal",
    objective: "Acompanhar a evolução dos projetos estratégicos, suas entregas, prazos, pendências e decisões da Diretoria.",
    topics: ["Status dos projetos em andamento", "Evolução das principais entregas", "Cronogramas e prazos", "Pendências e pontos de atenção", "Riscos e impedimentos", "Definição de prioridades", "Deliberações da Diretoria", "Responsáveis e próximos passos"],
    fields: [
      { key: "progress", label: "Evolução dos projetos e entregas", hint: "Registre avanços, marcos e situação dos cronogramas." },
      { key: "risks", label: "Pendências, riscos e impedimentos", hint: "Identifique os pontos críticos que dependem de decisão." },
      { key: "priorities", label: "Prioridades e deliberações", hint: "Registre as decisões da Diretoria." }, nextSteps,
    ],
  },
  RA: {
    name: "Reunião de Alinhamento", cadence: "Semanal",
    objective: "Alinhar a Alta Gestão, integrar as áreas e acompanhar as principais demandas e decisões da empresa.",
    topics: ["Atualizações relevantes das áreas", "Prioridades da semana", "Demandas que envolvam mais de uma área", "Pendências de reuniões anteriores", "Pontos que demandem decisão da gestão", "Definição de responsáveis e prazos", "Alinhamento das próximas ações"],
    fields: [
      { key: "updates", label: "Atualizações e prioridades da semana", hint: "Registre os destaques de cada área." },
      { key: "alignment", label: "Demandas entre áreas e pendências", hint: "Inclua pendências dos encontros anteriores." },
      { key: "decisions", label: "Alinhamentos e decisões da gestão", hint: "Registre os acordos da reunião." }, nextSteps,
    ],
  },
  RAO: {
    name: "Reunião de Alinhamento Operacional", cadence: "Semanal",
    objective: "Alinhar gestor e equipe, organizar prioridades e acompanhar responsabilidades, prazos e entregas.",
    topics: ["Prioridades da equipe", "Atividades em andamento", "Entregas realizadas e previstas", "Pendências e dificuldades", "Distribuição de responsabilidades", "Prazos e próximos passos", "Informações relevantes da empresa e da área"],
    fields: [
      { key: "priorities", label: "Prioridades e atividades da equipe", hint: "Registre a situação das demandas em andamento." },
      { key: "deliveries", label: "Entregas realizadas e previstas", hint: "Inclua prazos e distribuição de responsabilidades." },
      { key: "obstacles", label: "Pendências, dificuldades e informações", hint: "Registre o apoio necessário e os comunicados relevantes." }, nextSteps,
    ],
  },
  "1:1": {
    name: "Reunião Individual Gestor e Colaborador", cadence: "Mensal · 30 a 45 minutos",
    objective: "Um espaço de escuta, feedback, desenvolvimento e alinhamento individual entre líder e colaborador.",
    topics: ["Check-in: como você está e como foi o período?", "Entregas, resultados e conquistas", "Dificuldades, obstáculos e apoio necessário", "Feedback do gestor e do colaborador", "Desenvolvimento de competências e ações do PDI", "Gestor, equipe e ambiente de trabalho", "Compromissos, responsáveis, prazos e próximo encontro"],
    fields: [
      { key: "check_in", label: "Check-in e principais temas", hint: "Como foi o período desde o último 1:1? Registre apenas o necessário ao acompanhamento profissional." },
      { key: "results", label: "Entregas, resultados e reconhecimento", hint: "Quais foram os avanços e as conquistas?" },
      { key: "obstacles", label: "Dificuldades e apoio necessário", hint: "Inclua prioridades, recursos, treinamento e pontos de atenção." },
      { key: "leader_feedback", label: "Feedback do gestor", hint: "O que deve continuar e o que precisa ser desenvolvido?" },
      { key: "employee_feedback", label: "Feedback do colaborador", hint: "Registre alinhamentos sobre liderança, equipe e ambiente de trabalho." },
      { key: "development", label: "Desenvolvimento, PDI e expectativas", hint: "Registre competências, ações de desenvolvimento e expectativas profissionais." },
      nextSteps,
      { key: "follow_up", label: "Acompanhar no próximo 1:1", hint: "Quais pontos e compromissos devem ser retomados?" },
    ],
  },
};

export const DEFAULT_MEETING_PARTICIPANTS: Record<CollectiveMeetingType, string[]> = {
  RAE: ["Ana Cristina", "Aylton", "Awa", "Jivago", "Christiane", "Rosangela", "Thiago", "Kim"],
  RASP: ["Awa", "Jivago", "Christiane"],
  RA: ["Ana Cristina", "Aylton", "Awa", "Jivago", "Christiane", "Rosangela", "Thiago"],
  RAO: ["Christiane", "Rosangela", "Thiago", "Kamila", "Cassia", "Jessica", "Larissa", "Malaui", "Gabriela Santiago", "Gabriela Reis", "Samara", "Rayra", "Rafaela", "Adriana"],
};

export function meetingType(value: unknown): MeetingType {
  return MEETING_TYPES.includes(value as MeetingType) ? value as MeetingType : "RA";
}

export function meetingRecordLines(type: MeetingType, record: MeetingRecord = {}) {
  return MEETING_RITES[type].fields.flatMap((field) => record[field.key]?.trim() ? [`${field.label}:`, record[field.key].trim(), ""] : []);
}

export function defaultRiteDate(type: MeetingType, now = new Date()) {
  const date = new Date(now);
  if (type === "RAE") {
    if (date.getDate() > 15) date.setMonth(date.getMonth() + 1, 1);
    date.setDate(15);
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
