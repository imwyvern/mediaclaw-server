const path = require('node:path')

const [, , entrypoint, ...restArgs] = process.argv

if (!entrypoint) {
  throw new Error('docker-runtime.cjs requires an entrypoint path')
}

const hasConfigFlag = restArgs.includes('-c') || restArgs.includes('--config')
const runtimeArgs = hasConfigFlag
  ? restArgs
  : [...restArgs, '-c', path.resolve(__dirname, 'config.js')]

process.argv = [process.argv[0], entrypoint, ...runtimeArgs]
require(path.resolve(__dirname, entrypoint))
