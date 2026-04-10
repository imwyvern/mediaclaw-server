declare module 'adm-zip' {
  export default class AdmZip {
    constructor(buffer?: Buffer)
    addFile(entryName: string, content: Buffer): void
    toBuffer(): Buffer
    getEntries: () => Array<{ entryName: string, getData: () => Buffer }>
  }
}
