import type { MongodbConfig } from './mongodb.config'
import { Global } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import mongoose from 'mongoose'
import mongooseLeanVirtuals from 'mongoose-lean-virtuals'
import { configureMongoSlowQueryMonitor, createMongoSlowQueryPlugin } from './mongodb-slow-query.monitor'
import { repositories } from './repositories'
import { schemas } from './schemas'
import { TransactionalInjector } from './transactional.injector'

mongoose.plugin(mongooseLeanVirtuals)
mongoose.set('transactionAsyncLocalStorage', true)
configureMongoSlowQueryMonitor(Number(
  process.env['MEDIACLAW_MONGODB_SLOW_QUERY_MS']
  || process.env['MONGODB_SLOW_QUERY_MS']
  || 300,
))
mongoose.plugin(createMongoSlowQueryPlugin())

@Global()
export class MongodbModule {
  static forRoot(config: MongodbConfig) {
    const forFeature = MongooseModule.forFeature([...schemas])
    const { uri, ...options } = config

    return {
      imports: [
        MongooseModule.forRoot(uri, options),
        forFeature,
      ],
      providers: [
        ...repositories,
        TransactionalInjector,
      ],
      exports: [
        forFeature,
        ...repositories,
      ],
      module: MongodbModule,
      global: true,
    }
  }
}
