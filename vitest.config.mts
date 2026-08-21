import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/chrome-runtime.d.ts',
        'src/background.ts',
        'src/content/index.ts',
        'src/popup/index.ts',
      ],
    },
  },
});
