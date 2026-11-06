import { useQuery } from '@tanstack/react-query';
import { ErroApi, api } from '../api';

/**
 * Foto do pedido. Ela não tem endereço público: a tela pede o arquivo à API, com o login, e mostra o resultado.
 * Clicar abre a foto inteira numa nova aba.
 */
export function FotoPrivada({ id, nome }: { id: string; nome: string | null }) {
  const foto = useQuery({
    queryKey: ['foto', id],
    queryFn: async () => URL.createObjectURL(await api.foto(id)),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });

  if (foto.isError) {
    return (
      <span className="erro foto-erro" role="alert">
        {foto.error instanceof ErroApi ? foto.error.message : 'Não foi possível abrir a foto.'}
      </span>
    );
  }
  if (!foto.isSuccess) return <span className="foto foto-carregando" aria-label="Carregando a foto" />;

  return (
    <a className="foto" href={foto.data} target="_blank" rel="noreferrer" title="Abrir a foto inteira">
      <img src={foto.data} alt={nome ?? 'Foto de referência do pedido'} loading="lazy" />
    </a>
  );
}
