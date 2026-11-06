/** Tipos de imagem aceitos nas fotos de referência do pedido. */
export const TIPOS_DE_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoDeFoto = (typeof TIPOS_DE_FOTO)[number];

/** A tela reduz a foto antes de enviar; o servidor recusa o que passar disso. */
export const FOTO_TAMANHO_MAXIMO = 2 * 1024 * 1024;
export const FOTOS_POR_PEDIDO = 6;

function comeca(dados: Uint8Array, assinatura: number[], deslocamento = 0): boolean {
  return assinatura.every((byte, i) => dados[deslocamento + i] === byte);
}

/**
 * Descobre o tipo da imagem pelos primeiros bytes do arquivo, e não pelo que o navegador declarou:
 * quem manda um arquivo qualquer com o tipo "image/jpeg" não passa. Devolve null se não for JPEG, PNG ou WebP.
 * (Confere a assinatura do formato; não decodifica a imagem.)
 */
export function tipoDaImagem(dados: Uint8Array): TipoDeFoto | null {
  if (comeca(dados, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (comeca(dados, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // WebP: "RIFF" + 4 bytes de tamanho + "WEBP"
  if (comeca(dados, [0x52, 0x49, 0x46, 0x46]) && comeca(dados, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Nome do arquivo para mostrar: sem caracteres de controle nem quebras de linha, no máximo 100 letras. */
export function nomeDaFoto(nome: string | null | undefined): string | null {
  const limpo = (nome ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  return limpo || null;
}
