import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Perfil de quem está logado (nome, papel e setor), lido da API e guardado em cache por 5 minutos. */
export function useEu() {
  return useQuery({ queryKey: ['eu'], queryFn: api.eu, staleTime: 5 * 60_000 });
}
