import { describeModuleSpec } from '../testing/module-spec.factory'
import { CrawlerController } from './crawler.controller'
import { CrawlerModule } from './crawler.module'
import { CrawlerService } from './crawler.service'

describeModuleSpec<CrawlerService>({
  suiteName: 'CrawlerModule',
  module: CrawlerModule,
  service: CrawlerService,
  controller: CrawlerController,
  keyMethods: ['enqueueCrawl', 'getCrawlStatus', 'dualLayerRoute'],
})
