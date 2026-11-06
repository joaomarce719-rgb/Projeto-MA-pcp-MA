import { COMPROVANTE_TAMANHO_MAXIMO } from '@pcp/shared';
import { prepararFoto } from './imagem';

/**
 * Prepara o comprovante escolhido: imagem é reduzida no aparelho (como as fotos); PDF segue como está.
 * Explica o que deu errado se o arquivo não serve.
 */
export async function prepararComprovante(arquivo: File): Promise<Blob> {
  if (arquivo.type === 'application/pdf') {
    if (arquivo.size > COMPROVANTE_TAMANHO_MAXIMO) {
      throw new Error(`O PDF passa de ${COMPROVANTE_TAMANHO_MAXIMO / 1024 / 1024} MB. Envie um arquivo menor.`);
    }
    return arquivo;
  }
  if (arquivo.type.startsWith('image/')) return prepararFoto(arquivo);
  throw new Error('Envie uma imagem (JPEG, PNG ou WebP) ou um PDF.');
}
