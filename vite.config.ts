import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ['**/.tooling/**', '**/android/**', '**/artifacts/**', '**/docs/evidencias/**'] } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
