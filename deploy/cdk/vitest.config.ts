import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    typecheck: { tsconfig: './tsconfig.test.json' },
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: [['text', { skipFull: false }], 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['main.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**', '**/lib/**'],
      thresholds: {
        branches: 20,
        functions: 85,
        lines: 65,
        statements: 65,
      },
    },
  },
});
