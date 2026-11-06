import { describe, expect, it } from 'vitest';
import {
  entradaBody,
  entradaSugeridaCentavos,
  entregaBody,
  erroDaEntrega,
  erroDoRecebimento,
  pedidoBody,
  percentualPago,
  recebimentoBody,
  tipoDoComprovante,
} from './index';

const pedido = {
  tipo: 'Cliente',
  clienteId: '11111111-1111-4111-8111-111111111111',
  dataEntrega: '2026-11-10',
  itens: [{ produto: 'Camisa adulto malha dry fit', modo: 'adulto', grade: { M: 6, G: 4 } }],
};

function erros(corpo: unknown): Record<string, string> {
  const r = pedidoBody.safeParse(corpo);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('RN-24: entrada sugerida', () => {
  it('é metade do total, só como referência', () => {
    expect(entradaSugeridaCentavos(100_000)).toBe(50_000);
    expect(entradaSugeridaCentavos(12_345)).toBe(6_173);
    expect(entradaSugeridaCentavos(0)).toBe(0);
  });
});

describe('percentual pago', () => {
  it('vai de 0 a 100 e arredonda para baixo', () => {
    expect(percentualPago(10_000, 0)).toBe(0);
    expect(percentualPago(10_000, 3_333)).toBe(33);
    expect(percentualPago(10_000, 10_000)).toBe(100);
    expect(percentualPago(10_000, 99_999)).toBe(100);
  });
  it('pedido sem valor conta como pago', () => {
    expect(percentualPago(0, 0)).toBe(100);
  });
});

describe('RN-25 e RN-26: conferir um recebimento', () => {
  it('aceita valor dentro do saldo, com forma de pagamento', () => {
    expect(erroDoRecebimento(50_000, 50_000, 'Pix')).toBeNull();
    expect(erroDoRecebimento(50_000, 1, 'Dinheiro')).toBeNull();
  });
  it('recusa valor zero, negativo ou quebrado', () => {
    for (const v of [0, -100, 10.5, Number.NaN]) expect(erroDoRecebimento(50_000, v, 'Pix')).toMatch(/maior que zero/);
  });
  it('recusa valor acima do saldo e diz o saldo', () => {
    expect(erroDoRecebimento(50_000, 50_001, 'Pix')).toMatch(/saldo de R\$\s?500,00/);
  });
  it('recusa quando já está pago', () => {
    expect(erroDoRecebimento(0, 100, 'Pix')).toMatch(/pago por inteiro/);
  });
  it('exige a forma de pagamento e recusa forma desconhecida', () => {
    expect(erroDoRecebimento(50_000, 100, null)).toMatch(/forma de pagamento/);
    expect(erroDoRecebimento(50_000, 100, '')).toMatch(/forma de pagamento/);
    expect(erroDoRecebimento(50_000, 100, 'Cheque')).toMatch(/forma de pagamento/);
  });
});

describe('RN-30: entrega só com saldo zero', () => {
  it('recusa com saldo e diz quanto falta', () => {
    expect(erroDaEntrega(100_000, 40_000)).toMatch(/saldo de R\$\s?600,00/);
  });
  it('libera com saldo zero, ou pedido sem valor', () => {
    expect(erroDaEntrega(100_000, 100_000)).toBeNull();
    expect(erroDaEntrega(0, 0)).toBeNull();
  });
});

describe('corpos da API', () => {
  it('recebimento exige versão, valor inteiro positivo e forma', () => {
    expect(recebimentoBody.safeParse({ versao: 3, valorCentavos: 5_000, forma: 'Pix' }).success).toBe(true);
    expect(recebimentoBody.safeParse({ versao: 3, valorCentavos: 50.5, forma: 'Pix' }).success).toBe(false);
    expect(recebimentoBody.safeParse({ versao: 3, valorCentavos: 5_000, forma: 'Fiado' }).success).toBe(false);
    expect(recebimentoBody.safeParse({ valorCentavos: 5_000, forma: 'Pix' }).success).toBe(false);
  });
  it('recusa um valor absurdo (erro de digitação)', () => {
    expect(entradaBody.safeParse({ valorCentavos: 100_000_001, forma: 'Pix' }).success).toBe(false);
  });
  it('entrega exige a versão que a pessoa viu', () => {
    expect(entregaBody.safeParse({ versao: 2 }).success).toBe(true);
    expect(entregaBody.safeParse({}).success).toBe(false);
  });
});

describe('pedido com entrada', () => {
  it('sem entrada continua válido (o valor total é calculado pela API, pelo catálogo)', () => {
    expect(erros(pedido)).toEqual({});
    expect(pedidoBody.parse(pedido)).not.toHaveProperty('totalCentavos');
  });
  it('aceita entrada com valor e forma de pagamento', () => {
    expect(erros({ ...pedido, entrada: { valorCentavos: 100_000, forma: 'Pix' } })).toEqual({});
  });
  it('recusa entrada sem forma de pagamento', () => {
    expect(erros({ ...pedido, entrada: { valorCentavos: 100 } })['entrada.forma']).toMatch(/forma de pagamento/);
  });
  it('pedido de Feira não tem entrada', () => {
    const feira = { ...pedido, tipo: 'Feira', clienteId: undefined, descricao: 'Feira do Centro' };
    expect(erros(feira)).toEqual({});
    expect(erros({ ...feira, entrada: { valorCentavos: 100, forma: 'Pix' } }).entrada).toMatch(/feira/i);
  });
});

describe('tipo do comprovante pelos bytes', () => {
  it('reconhece imagem e PDF, e recusa o resto', () => {
    expect(tipoDoComprovante(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoDoComprovante(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(tipoDoComprovante(new TextEncoder().encode('MZ executável'))).toBeNull();
    expect(tipoDoComprovante(new Uint8Array([]))).toBeNull();
  });
});
