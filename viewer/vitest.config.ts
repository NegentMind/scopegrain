import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest-only options live here so `vite build`/`dev` keep working without
// the test devDependencies installed.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
