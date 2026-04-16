import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/mediaclaw-tools-quality',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'mediaclaw-tools-quality',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs}'],
    reporters: ['default'],
    coverage: { reportsDirectory: '../../coverage/libs/mediaclaw-tools-quality', provider: 'v8' },
  },
}))
