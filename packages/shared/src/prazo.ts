export const FUSO = 'America/Fortaleza';

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** RN-33: o dia (AAAA-MM-DD) no horário de Fortaleza, inclusive depois das 21h. */
export function diaEmFortaleza(instante: Date = new Date()): string {
  const partes: Record<string, string> = {};
  for (const p of formatoDia.formatToParts(instante)) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function paraDias(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(a, m - 1, d) / 86_400_000);
}

export function diferencaEmDias(a: string, b: string): number {
  return paraDias(a) - paraDias(b);
}

/** Soma (ou subtrai) dias a um dia AAAA-MM-DD, sem depender do fuso do aparelho. */
export function somarDias(dia: string, n: number): string {
  return new Date((paraDias(dia) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** O texto é um dia de calendário que existe (rejeita 2026-02-31 e formatos soltos). */
export function ehDiaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

/** RN-05: a data de entrega é obrigatória, existe no calendário e não é anterior a hoje. Devolve o erro, ou null. */
export function erroDaDataDeEntrega(entrega: string, hoje: string = diaEmFortaleza()): string | null {
  if (!ehDiaValido(entrega)) return 'Informe a data de entrega.';
  if (diferencaEmDias(entrega, hoje) < 0) return 'A data de entrega não pode ser no passado.';
  return null;
}

/** Atrasado = a data de entrega já passou (RN-34, vermelho). Entregar hoje ainda não é atraso. */
export function estaAtrasado(entrega: string, hoje: string = diaEmFortaleza()): boolean {
  return diferencaEmDias(entrega, hoje) < 0;
}

/** Entrega nos próximos `dias` dias, contando hoje (RF-05: "entregas dos próximos 7 dias" = hoje até hoje + 6). */
export function entregaNosProximosDias(entrega: string, dias: number, hoje: string = diaEmFortaleza()): boolean {
  const d = diferencaEmDias(entrega, hoje);
  return d >= 0 && d < dias;
}

export type CorPrazo = 'vermelho' | 'ambar' | 'verde';

/** RN-34: vermelho depois da entrega; âmbar no dia, na véspera e a 2 dias; verde com 3 dias ou mais. */
export function semaforoDoPrazo(entrega: string, hoje: string = diaEmFortaleza()): { cor: CorPrazo; texto: string } {
  const d = diferencaEmDias(entrega, hoje);
  if (d < 0) return { cor: 'vermelho', texto: d === -1 ? 'Atrasado 1 dia' : `Atrasado ${-d} dias` };
  if (d === 0) return { cor: 'ambar', texto: 'Entrega hoje' };
  if (d === 1) return { cor: 'ambar', texto: 'Entrega amanhã' };
  if (d === 2) return { cor: 'ambar', texto: 'Faltam 2 dias' };
  return { cor: 'verde', texto: `Faltam ${d} dias` };
}
