import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cada teste abre um Postgres novo em memória (PGlite, que carrega WebAssembly). Em máquina lenta ou ocupada isso passa
    // dos 10 s padrão e o teste "falha" sem ter nada errado; 60 s dá folga sem esconder um travamento de verdade.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
