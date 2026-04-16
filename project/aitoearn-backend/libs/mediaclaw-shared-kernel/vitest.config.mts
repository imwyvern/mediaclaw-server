import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/mediaclaw-shared-kernel',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'mediaclaw-shared-kernel',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/mediaclaw-shared-kernel',
      provider: 'v8' as const,
    },
  },
}))
