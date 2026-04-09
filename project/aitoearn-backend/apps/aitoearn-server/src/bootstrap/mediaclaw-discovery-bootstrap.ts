import { NestFactory } from '@nestjs/core'
import { Command } from 'commander'
import { AppModule } from '../app.module'
import { DEFAULT_DISCOVERY_INDUSTRIES, DEFAULT_DISCOVERY_PLATFORMS } from '../core/mediaclaw/discovery/discovery.constants'
import { DiscoveryIngestionService } from '../core/mediaclaw/discovery/ingestion.service'

async function bootstrap() {
  const program = new Command()
    .name('mediaclaw-discovery-bootstrap')
    .option(
      '--industries <industries>',
      '逗号分隔的行业列表',
      DEFAULT_DISCOVERY_INDUSTRIES.join(','),
    )
    .option(
      '--platforms <platforms>',
      '逗号分隔的平台列表',
      DEFAULT_DISCOVERY_PLATFORMS.join(','),
    )

  program.parse(process.argv)
  const options = program.opts<{ industries: string, platforms: string }>()
  const industries = options.industries
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const platforms = options.platforms
    .split(',')
    .map(item => item.trim())
    .filter(Boolean) as typeof DEFAULT_DISCOVERY_PLATFORMS[number][]

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  })

  try {
    const discoveryIngestionService = app.get(DiscoveryIngestionService)
    const result = await discoveryIngestionService.runBootstrap(industries, platforms)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  finally {
    await app.close()
  }
}

bootstrap().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
