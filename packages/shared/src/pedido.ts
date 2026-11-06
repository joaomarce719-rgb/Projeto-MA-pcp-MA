import { z } from 'zod';
import { entradaBody, type ValoresDoPedido } from './pagamento';

export const GRADE_ADULTO = ['PP', 'P', 'M', 'G', 'GG', 'XG'] as const;
export const GRADE_INFANTIL = ['2', '4', '6', '8', '10', '12', '14'] as const;
export type ModoGrade = 'adulto' | 'infantil';
export const TAMANHOS: Record<ModoGrade, readonly string[]> = { adulto: GRADE_ADULTO, infantil: GRADE_INFANTIL };

export const PUNHOS = ['Sem punho', 'Punho ribana', 'Punho na mesma malha', 'Punho com listra'] as const;
export const PRIORIDADES = ['Normal', 'Alta', 'Urgente'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

export type Grade = Record<string, number>;

export interface Adicionais {
  patch: boolean;
  punho: boolean;
  golaV: boolean;
}

/** Soma só os tamanhos que existem para o modo (adulto ou infantil). */
export function quantidadeDaGrade(modo: ModoGrade, grade: Grade): number {
  return TAMANHOS[modo].reduce((soma, t) => soma + (Number.isInteger(grade[t]) ? (grade[t] as number) : 0), 0);
}

const adicionaisPadrao: Adicionais = { patch: false, punho: false, golaV: false };

export const itemPedido = z
  .object({
    produto: z.string().trim().min(3, 'Informe o produto.').max(120),
    modo: z.enum(['adulto', 'infantil']),
    grade: z.record(z.string(), z.number().int().min(0).max(999)),
    adicionais: z
      .object({ patch: z.boolean().default(false), punho: z.boolean().default(false), golaV: z.boolean().default(false) })
      .default(adicionaisPadrao),
  })
  .superRefine((item, ctx) => {
    const validos = TAMANHOS[item.modo];
    const invalido = Object.keys(item.grade).find((t) => !validos.includes(t));
    if (invalido) ctx.addIssue({ code: 'custom', path: ['grade', invalido], message: `Tamanho ${invalido} não existe na grade ${item.modo}.` });
    if (quantidadeDaGrade(item.modo, item.grade) < 1) {
      ctx.addIssue({ code: 'custom', path: ['grade'], message: `Preencha a grade de ${item.produto} ou remova o produto.` });
    }
  });
export type ItemPedido = z.infer<typeof itemPedido>;

export const pedidoBody = z
  .object({
    tipo: z.enum(['Cliente', 'Feira']),
    clienteId: z.string().uuid().optional(),
    descricao: z.string().trim().max(120).optional(),
    prioridade: z.enum(PRIORIDADES).default('Normal'),
    dataEntrega: z.string(),
    bordado: z.boolean().default(false),
    punho: z.enum(PUNHOS).default('Sem punho'),
    detalhes: z.string().trim().max(1000).optional(),
    itens: z.array(itemPedido).min(1, 'Adicione pelo menos um produto.').max(30),
    /** RN-24: sem entrada, o campo não vem. */
    entrada: entradaBody.optional(),
  })
  .superRefine((p, ctx) => {
    // Pedido de Feira não passa pelo financeiro: não tem valor nem entrada.
    if (p.tipo === 'Feira' && p.entrada) {
      ctx.addIssue({ code: 'custom', path: ['entrada'], message: 'Pedido de feira não tem valor nem entrada.' });
    }
    // RN-25 (a entrada não passa do total) é conferida contra o total que a API calcula pelo catálogo.
    // RN-03
    if (p.tipo === 'Cliente' && !p.clienteId) {
      ctx.addIssue({ code: 'custom', path: ['clienteId'], message: 'Escolha um cliente salvo ou cadastre um novo.' });
    }
    if (p.tipo === 'Feira' && (p.descricao ?? '').length < 3) {
      ctx.addIssue({ code: 'custom', path: ['descricao'], message: 'Descreva a feira para continuar.' });
    }
    // RN-13
    if (p.itens.some((i) => i.adicionais.patch) && !p.bordado) {
      ctx.addIssue({ code: 'custom', path: ['bordado'], message: 'Há produto com patch: o pedido precisa de bordado.' });
    }
    // RN-14
    if (p.itens.some((i) => i.adicionais.punho) && p.punho === 'Sem punho') {
      ctx.addIssue({ code: 'custom', path: ['punho'], message: 'Há produto com o adicional punho: escolha o tipo de punho.' });
    }
  });
export type PedidoBody = z.infer<typeof pedidoBody>;

export const clienteBody = z.object({
  nome: z.string().trim().min(3, 'Informe o nome do cliente.').max(120),
  documento: z.string().trim().max(20).optional(),
  telefone: z.string().trim().max(30).optional(),
  cidade: z.string().trim().max(80).optional(),
});
export type ClienteBody = z.infer<typeof clienteBody>;

export const devolverBody = z.object({
  versao: z.number().int().min(1),
  motivo: z.string().trim().min(3, 'Descreva o motivo da devolução.').max(500),
});
export type DevolverBody = z.infer<typeof devolverBody>;

export interface ClienteLinha {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  cidade: string | null;
}

export interface EventoHistorico {
  etapa: string;
  tipo: 'Cadastro' | 'Conclusão' | 'Recuperação' | 'Finalização';
  nota: string | null;
  maquina: string | null;
  pecas: number | null;
  por: string | null;
  em: string;
}

export interface FotoFicha {
  id: string;
  nome: string | null;
}

export interface ItemFicha {
  produto: string;
  modo: ModoGrade;
  grade: Grade;
  quantidade: number;
  adicionais: Adicionais;
  /** Malha do produto (vem do catálogo); pedidos antigos podem não ter. */
  malha: string | null;
}

/** Ficha do pedido. `cliente` só vem para atendimento, direção e admin; o setor nunca recebe documento nem telefone (RNF-02). */
export interface FichaLote {
  id: string;
  numero: number;
  tipo: 'Cliente' | 'Feira';
  descricao: string;
  quantidade: number;
  prioridade: Prioridade;
  dataEntrega: string;
  bordado: boolean;
  punho: string;
  detalhes: string | null;
  etapa: string;
  versao: number;
  recuperacaoPendente: boolean;
  itens: ItemFicha[];
  /** RF-20: malha do calção (dos produtos de calção, bermuda ou calça), ou "Não se aplica". */
  malhaCalcao: string;
  fotos: FotoFicha[];
  historico: EventoHistorico[];
  cliente?: ClienteLinha;
  /** Só em pedido de Cliente, para atendimento, direção e admin. */
  valores?: ValoresDoPedido;
}
