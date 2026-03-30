import 'reflect-metadata'
import { afterEach, vi } from 'vitest'
import '../apps/aitoearn-server/src/core/mediaclaw/testing/module-spec.factory'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
