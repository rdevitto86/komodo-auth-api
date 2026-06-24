import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/shared/logging/**/*.test.ts',
      'src/deploy/cdk/**/*.test.ts',
    ],
    exclude: [
      'src/shared/logging/logging.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/logging/**/*.ts',
        'src/deploy/cdk/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/shared/logging/common/worker/browser/browser.ts',
        'src/shared/logging/common/worker/node/node.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
