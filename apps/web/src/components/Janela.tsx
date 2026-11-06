import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Janela por cima da tela (sobe de baixo no celular). Fecha com Esc ou clicando fora, leva o foco para dentro
 * ao abrir e devolve o foco ao botão que a abriu ao fechar (RNF-10).
 */
export function Janela({ titulo, aoFechar, largura, children }: { titulo: string; aoFechar: () => void; largura?: 'larga'; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    caixa.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
    // aoFechar muda a cada renderização do pai; o efeito só precisa rodar ao abrir e ao fechar.
  }, []);

  return (
    <div className="fundo" role="presentation" onClick={aoFechar}>
      <div
        ref={caixa}
        tabIndex={-1}
        className={`janela${largura ? ` ${largura}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
