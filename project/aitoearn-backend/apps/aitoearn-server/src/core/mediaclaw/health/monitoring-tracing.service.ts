import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,

} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from '@opentelemetry/semantic-conventions'
import { MediaclawConfigService } from '../mediaclaw-config.service'

@Injectable()
export class MonitoringTracingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringTracingService.name)
  private readonly tracerName = 'mediaclaw-api'
  private provider: BasicTracerProvider | null = null
  private middlewareMounted = false
  private contextManager: AsyncLocalStorageContextManager | null = null

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: MediaclawConfigService,
  ) {}

  onApplicationBootstrap() {
    this.initializeProvider()
    this.mountMiddleware()
  }

  async onModuleDestroy() {
    await this.provider?.shutdown().catch(() => undefined)
    this.contextManager?.disable()
  }

  private initializeProvider() {
    if (this.provider) {
      return
    }

    const spanProcessors = this.resolveSpanProcessors()
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.configService.getString('MEDIACLAW_OTEL_SERVICE_NAME', 'mediaclaw-api'),
        [ATTR_SERVICE_NAMESPACE]: 'mediaclaw',
        'service.instance.id': process.env['HOSTNAME'] || randomUUID(),
        'deployment.environment.name': this.configService.getString('NODE_ENV', 'development'),
      }),
      spanProcessors,
    })
    this.contextManager = new AsyncLocalStorageContextManager().enable()
    trace.setGlobalTracerProvider(this.provider)
    context.setGlobalContextManager(this.contextManager)
    this.logger.log('MediaClaw OpenTelemetry tracing initialized')
  }

  private mountMiddleware() {
    if (this.middlewareMounted) {
      return
    }

    const httpAdapter = this.httpAdapterHost.httpAdapter
    const app = httpAdapter?.getInstance?.()
    if (!app?.use) {
      return
    }

    const tracer = trace.getTracer(this.tracerName, process.env['npm_package_version'] || '0.0.0')
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === '/metrics') {
        next()
        return
      }

      const route = this.normalizeRoute(request)
      const parentContext = this.extractParentContext(request.headers['traceparent'])
      const startedAt = process.hrtime.bigint()
      context.with(parentContext, () => {
        tracer.startActiveSpan(
          `${request.method} ${route}`,
          {
            kind: SpanKind.SERVER,
            attributes: {
              'http.method': request.method,
              'http.route': route,
              'http.target': request.originalUrl || route,
              'http.user_agent': String(request.headers['user-agent'] || ''),
            },
          },
          (span) => {
            let finished = false
            const spanContext = span.spanContext()
            response.setHeader('traceparent', this.buildTraceparent(spanContext.traceId, spanContext.spanId, spanContext.traceFlags))
            response.setHeader('x-trace-id', spanContext.traceId)

            const closeSpan = (statusCode: number, aborted = false) => {
              if (finished) {
                return
              }

              finished = true
              const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
              span.setAttribute('http.status_code', statusCode)
              span.setAttribute('http.duration_ms', durationMs)
              if (aborted) {
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: 'request_aborted',
                })
              }
              else if (statusCode >= 500) {
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: `http_${statusCode}`,
                })
              }
              else {
                span.setStatus({ code: SpanStatusCode.OK })
              }
              span.end()
            }

            response.on('finish', () => closeSpan(response.statusCode))
            response.on('close', () => closeSpan(response.statusCode || 499, true))
            next()
          },
        )
      })
    })

    this.middlewareMounted = true
  }

  private resolveSpanProcessors() {
    const otlpEndpoint = this.configService.getString(
      [
        'MEDIACLAW_OTEL_EXPORTER_URL',
        'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
        'OTEL_EXPORTER_OTLP_ENDPOINT',
      ],
      '',
    )
    if (otlpEndpoint) {
      return [
        new BatchSpanProcessor(new OTLPTraceExporter({
          url: otlpEndpoint,
          headers: this.parseOtlpHeaders(this.configService.getString('OTEL_EXPORTER_OTLP_HEADERS', '')),
        })),
      ] satisfies SpanProcessor[]
    }

    const exporterMode = this.configService.getString('MEDIACLAW_OTEL_EXPORTER', '').trim().toLowerCase()
    if (exporterMode === 'console') {
      return [
        new SimpleSpanProcessor(new ConsoleSpanExporter()),
      ] satisfies SpanProcessor[]
    }

    return []
  }

  private parseOtlpHeaders(rawHeaders: string) {
    if (!rawHeaders.trim()) {
      return undefined
    }

    return rawHeaders
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .reduce<Record<string, string>>((headers, item) => {
        const [key, ...valueParts] = item.split('=')
        const normalizedKey = key?.trim()
        const normalizedValue = valueParts.join('=').trim()
        if (normalizedKey && normalizedValue) {
          headers[normalizedKey] = normalizedValue
        }
        return headers
      }, {})
  }

  private extractParentContext(traceparentHeader: string | string[] | undefined) {
    const traceparent = Array.isArray(traceparentHeader)
      ? traceparentHeader[0]?.trim()
      : traceparentHeader?.trim()
    if (!traceparent) {
      return ROOT_CONTEXT
    }

    const matched = traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i)
    if (!matched) {
      return ROOT_CONTEXT
    }

    const [, traceId, spanId, flags] = matched
    return trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId,
      isRemote: true,
      traceFlags: Number.parseInt(flags, 16) & TraceFlags.SAMPLED
        ? TraceFlags.SAMPLED
        : TraceFlags.NONE,
    })
  }

  private buildTraceparent(traceId: string, spanId: string, traceFlags: number) {
    const sampled = traceFlags & TraceFlags.SAMPLED ? '01' : '00'
    return `00-${traceId}-${spanId}-${sampled}`
  }

  private normalizeRoute(request: Request) {
    const basePath = request.baseUrl || ''
    const path = request.path || request.route?.path || request.originalUrl || '/'
    const withoutQuery = `${basePath}${path}`.split('?')[0] || '/'
    return withoutQuery.replace(/\/+/g, '/') || '/'
  }
}
