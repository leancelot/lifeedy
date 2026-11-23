import type confetti from 'canvas-confetti';

/**
 * Carrega `canvas-confetti` sob demanda apenas no momento da celebração,
 * removendo a biblioteca do bundle inicial de inicialização.
 */
export function triggerConfetti(options?: confetti.Options): void {
  void import('canvas-confetti')
    .then((mod) => {
      const fire = mod.default;
      if (typeof fire === 'function') {
        void fire(options);
      }
    })
    .catch(() => {
      // Ignora falhas de carregamento dinâmico; efeito visual é opcional.
    });
}
