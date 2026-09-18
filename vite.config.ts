import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', rolldownOptions: { input: ['index.html', 'agent.html'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
