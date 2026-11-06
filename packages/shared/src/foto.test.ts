import { describe, expect, it } from 'vitest';
import { nomeDaFoto, tipoDaImagem } from './index';

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('tipo da imagem pelos bytes', () => {
  it('reconhece JPEG, PNG e WebP', () => {
    expect(tipoDaImagem(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(tipoDaImagem(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(tipoDaImagem(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
  });

  it('recusa o que não é imagem aceita', () => {
    expect(tipoDaImagem(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(tipoDaImagem(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(tipoDaImagem(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull(); // GIF
    expect(tipoDaImagem(new Uint8Array(0))).toBeNull();
  });

  it('RIFF que não é WebP (por exemplo, WAV) é recusado', () => {
    expect(tipoDaImagem(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
});

describe('nome da foto', () => {
  it('tira caracteres de controle e limita o tamanho', () => {
    expect(nomeDaFoto('  frente\u0000\n.jpg ')).toBe('frente.jpg');
    expect(nomeDaFoto('a'.repeat(300))).toHaveLength(100);
  });
  it('vazio ou ausente vira null', () => {
    expect(nomeDaFoto('')).toBeNull();
    expect(nomeDaFoto('  \n ')).toBeNull();
    expect(nomeDaFoto(undefined)).toBeNull();
    expect(nomeDaFoto(null)).toBeNull();
  });
});
