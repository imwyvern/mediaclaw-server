import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('mediaclaw skill cli', () => {
  const skillScriptsDir = path.resolve(__dirname, '../../../../../../libs/mediaclaw-skill/scripts')
  const scriptPath = path.join(skillScriptsDir, 'mc-api.sh')
  const clientPath = path.join(skillScriptsDir, 'mediaclaw-client')

  it('应通过 bash 语法检查', () => {
    expect(() => execFileSync('bash', ['-n', scriptPath], { encoding: 'utf8' })).not.toThrow()
  })

  it('应在帮助输出中暴露 L1-L4 命令矩阵', () => {
    const output = execFileSync(clientPath, ['help'], { encoding: 'utf8' })

    expect(output).toContain('L1 内容交付')
    expect(output).toContain('L2 内容管理')
    expect(output).toContain('L3 数据查询')
    expect(output).toContain('L4 生产控制')
    expect(output).toContain('my-videos')
    expect(output).toContain('competitor-report')
    expect(output).toContain('adjust-style')
  })

  it('应支持按层查看 L4 能力和风格控制命令', () => {
    const output = execFileSync(clientPath, ['help', 'L4'], { encoding: 'utf8' })

    expect(output).toContain('L4 生产控制')
    expect(output).toContain('style-preferences')
    expect(output).toContain('adjust-style')
    expect(output).toContain('create-task')
  })
})
