/**
 * Onde ficam os arquivos (fotos de referência, e depois os comprovantes). Só a API lê e grava: o navegador nunca
 * recebe um endereço do armazenamento, e cada arquivo sai por uma rota que confere a permissão (RNF-03).
 */
export interface Armazenamento {
  guardar(chave: string, dados: ArrayBuffer, tipo: string): Promise<void>;
  ler(chave: string): Promise<{ dados: ReadableStream | ArrayBuffer; tipo: string } | null>;
  apagar(chave: string): Promise<void>;
}

/** Cloudflare R2, pelo vínculo (binding) `ARQUIVOS` do Worker. */
export function armazenamentoR2(balde: R2Bucket): Armazenamento {
  return {
    async guardar(chave, dados, tipo) {
      await balde.put(chave, dados, { httpMetadata: { contentType: tipo } });
    },
    async ler(chave) {
      const objeto = await balde.get(chave);
      if (!objeto) return null;
      return { dados: objeto.body, tipo: objeto.httpMetadata?.contentType ?? 'application/octet-stream' };
    },
    async apagar(chave) {
      await balde.delete(chave);
    },
  };
}

/** Para testes e para o servidor de demonstração (`dev-local.ts`); os arquivos somem ao parar. */
export function armazenamentoEmMemoria(): Armazenamento & { arquivos: Map<string, { dados: ArrayBuffer; tipo: string }> } {
  const arquivos = new Map<string, { dados: ArrayBuffer; tipo: string }>();
  return {
    arquivos,
    async guardar(chave, dados, tipo) {
      arquivos.set(chave, { dados: dados.slice(0), tipo });
    },
    async ler(chave) {
      const a = arquivos.get(chave);
      return a ? { dados: a.dados.slice(0), tipo: a.tipo } : null;
    },
    async apagar(chave) {
      arquivos.delete(chave);
    },
  };
}
