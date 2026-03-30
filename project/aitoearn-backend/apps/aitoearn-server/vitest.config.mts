import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/aitoearn-server',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'aitoearn-server',
    watch: false,
    globals: true,
    environment: 'node',
    setupFiles: ['../../test/setup.ts'],
    include: [
      '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      '../../test/**/*.e2e-spec.ts',
    ],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/aitoearn-server',
      provider: 'v8' as const,
    },
  },
}))
