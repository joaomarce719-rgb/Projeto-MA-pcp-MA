import { z } from 'zod';
import { MAQUINAS } from './rota';

export const concluirBody = z.object({
  /** Versão do lote que a pessoa estava vendo; protege contra duas pessoas mexendo ao mesmo tempo. */
  versao: z.number().int().min(1),
  maquina: z.enum(MAQUINAS).optional(),
  pecas: z.number().int().min(1).optional(),
  nota: z.string().trim().max(500).optional(),
});
export type ConcluirBody = z.infer<typeof concluirBody>;

export const papeis = ['atendimento', 'setor', 'direcao', 'admin'] as const;
export type Papel = (typeof papeis)[number];

export interface Perfil {
  id: string;
  nome: string;
  papel: Papel;
  setor: string | null;
  /** Só vale para o Atendimento: o Administrador deu a permissão de gerenciar preços (RN-11). */
  gerenciaPrecos?: boolean;
}

export interface LoteFila {
  id: string;
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  quantidade: number;
  prioridade: 'Urgente' | 'Alta' | 'Normal';
  dataEntrega: string;
  bordado: boolean;
  etapa: string;
  versao: number;
  recuperacaoPendente: boolean;
  /** Motivo da última devolução ao Design; só preenchido enquanto o pedido está em recuperação. */
  motivoRecuperacao: string | null;
  /** Valor e recebido em centavos: só para atendimento e admin (o setor nunca recebe valores). */
  totalCentavos?: number;
  recebidoCentavos?: number;
}
