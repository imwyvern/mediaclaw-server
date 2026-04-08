import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('mediaclaw skill cli', () => {
  const scriptPath = path.resolve(process.cwd(), '../../libs/mediaclaw-skill/scripts/mc-api.sh')

  it('应通过 bash 语法检查', () => {
    expect(() => execFileSync('bash', ['-n', scriptPath], { encoding: 'utf8' })).not.toThrow()
  })

  it('应在帮助输出中暴露 L1-L4 命令矩阵', () => {
    const output = execFileSync('bash', [scriptPath, 'help'], { encoding: 'utf8' })

    expect(output).toContain('discover')
    expect(output).toContain('heartbeat')
    expect(output).toContain('task-status')
    expect(output).toContain('brand-update')
    expect(output).toContain('analytics-report')
    expect(output).toContain('pipeline-bind-group')
    expect(output).toContain('campaign-create')
  })
})
