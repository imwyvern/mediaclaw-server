declare module 'archiver' {
  import type { Writable } from 'node:stream'

  interface ArchiveInstance {
    append: (data: Buffer | string, options: { name: string }) => void
    finalize: () => Promise<void>
    on: (event: string, listener: (...args: any[]) => void) => this
    pipe: (target: Writable) => void
  }

  export default function archiver(
    format: 'zip',
    options?: Record<string, unknown>,
  ): ArchiveInstance
}
