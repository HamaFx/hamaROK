import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/assistant/service.ts',
        'src/lib/ocr/ocr-engine.ts',
        'src/lib/rankings/service.ts',
        'src/lib/metric-sync.ts',
      ],
      thresholds: {
        statements: 25,
        branches: 60,
        functions: 40,
        lines: 25,
        'src/lib/api-response.ts': {
          statements: 55,
          branches: 60,
          functions: 50,
          lines: 55,
        },
        'src/lib/mistral/client.ts': {
          statements: 65,
          branches: 50,
          functions: 75,
          lines: 65,
        },
        'src/lib/idempotency.ts': {
          statements: 20,
          branches: 90,
          functions: 20,
          lines: 20,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
