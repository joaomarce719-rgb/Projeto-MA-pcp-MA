import { FUSO } from '@pcp/shared';

const partesDaData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "23/10, 14:05", sempre no horário de Fortaleza. Montado das partes para sair igual em qualquer navegador. */
export function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p: Record<string, string> = {};
  for (const parte of partesDaData.formatToParts(d)) p[parte.type] = parte.value;
  return `${p.day}/${p.month}, ${p.hour}:${p.minute}`;
}

/** "2026-11-10" → "10/11/2026" */
export function dataBR(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}
