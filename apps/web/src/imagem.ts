import { FOTO_TAMANHO_MAXIMO } from '@pcp/shared';

/** Lado maior da foto depois de reduzida. Basta para o setor ver os detalhes e deixa o arquivo pequeno. */
const LADO_MAXIMO = 1600;

/**
 * Reduz a foto no aparelho antes de enviar: respeita a orientação do celular, limita o lado maior e converte para JPEG
 * (fundo branco, para PNG com transparência). Devolve um arquivo dentro do limite do servidor, ou explica o que deu errado.
 */
export async function prepararFoto(arquivo: File): Promise<Blob> {
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não foi possível ler esta imagem. Use uma foto JPEG, PNG ou WebP.');
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.width, imagem.height));
  const tela = document.createElement('canvas');
  tela.width = Math.max(1, Math.round(imagem.width * escala));
  tela.height = Math.max(1, Math.round(imagem.height * escala));
  const pincel = tela.getContext('2d');
  if (!pincel) throw new Error('Este aparelho não consegue preparar a foto.');
  pincel.fillStyle = '#fff';
  pincel.fillRect(0, 0, tela.width, tela.height);
  pincel.drawImage(imagem, 0, 0, tela.width, tela.height);
  imagem.close();

  for (const qualidade of [0.82, 0.65, 0.5]) {
    const jpeg = await new Promise<Blob | null>((ok) => tela.toBlob(ok, 'image/jpeg', qualidade));
    if (jpeg && jpeg.size <= FOTO_TAMANHO_MAXIMO) return jpeg;
  }
  throw new Error('A foto continua grande demais mesmo reduzida. Tire outra foto.');
}
