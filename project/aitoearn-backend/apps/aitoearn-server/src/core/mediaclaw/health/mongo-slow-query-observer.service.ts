import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { Injectable, Logger } from '@nestjs/common'
import { onMongoSlowQuery } from '@yikart/mongodb'
import { MonitoringMetricsService } from './monitoring-metrics.service'

@Injectable()
export class MongoSlowQueryObserverService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MongoSlowQueryObserverService.name)
  private unsubscribe: (() => void) | null = null

  constructor(private readonly metricsService: MonitoringMetricsService) {}

  onApplicationBootstrap() {
    if (this.unsubscribe) {
      return
    }

    this.unsubscribe = onMongoSlowQuery((event) => {
      this.metricsService.recordMongoSlowQuery(event)
      this.logger.warn({
        message: 'Mongo slow query detected',
        operation: event.operation,
        collectionName: event.collectionName,
        durationMs: event.durationMs,
      })
    })
  }

  onModuleDestroy() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
