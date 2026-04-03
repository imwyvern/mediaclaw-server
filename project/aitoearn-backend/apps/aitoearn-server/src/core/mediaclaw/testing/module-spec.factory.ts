import type { Type } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import { Inject } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { vi } from 'vitest'

interface QueueJobRecord {
  id: string
  name: string
  data: Record<string, any>
  opts: Record<string, any>
  attemptsMade: number
  timestamp: number
  delay: number
  finishedOn: number | null
  progress: number
  returnvalue: any[]
  getState: ReturnType<typeof vi.fn>
}

const testingHarness = vi.hoisted(() => {
  const mongooseConnectionToken = 'MockMongooseConnection'
  const modelMocks = new Map<string, Record<string, any>>()
  const queueMocks = new Map<string, any>()

  function createChainableQuery<T>(value: T) {
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn(),
      select: vi.fn(),
      populate: vi.fn(),
      exec: vi.fn().mockResolvedValue(value),
    }

    query.sort.mockReturnValue(query)
    query.skip.mockReturnValue(query)
    query.limit.mockReturnValue(query)
    query.lean.mockReturnValue(query)
    query.select.mockReturnValue(query)
    query.populate.mockReturnValue(query)

    return query
  }

  function createModelMock(name: string) {
    const defaultDocument = {
      _id: `${name.toLowerCase()}-id`,
      name: `${name} mock`,
      orgId: 'org-1',
      userId: 'user-1',
      metadata: {},
      toObject: () => ({
        _id: `${name.toLowerCase()}-id`,
        name: `${name} mock`,
        orgId: 'org-1',
        userId: 'user-1',
        metadata: {},
      }),
    }

    return {
      aggregate: vi.fn().mockResolvedValue([]),
      countDocuments: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(defaultDocument),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      distinct: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false),
      find: vi.fn().mockReturnValue(createChainableQuery([])),
      findById: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      findByIdAndDelete: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      findByIdAndUpdate: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      findOne: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      findOneAndDelete: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      findOneAndUpdate: vi.fn().mockReturnValue(createChainableQuery(defaultDocument)),
      insertMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockReturnValue(createChainableQuery({ modifiedCount: 0 })),
      updateOne: vi.fn().mockReturnValue(createChainableQuery({ modifiedCount: 0 })),
    }
  }

  function getModelToken(name: string) {
    return `${name}Model`
  }

  function getQueueToken(name: string) {
    return `BullQueue_${name}`
  }

  function getOrCreateModelMock(name: string) {
    if (!modelMocks.has(name)) {
      modelMocks.set(name, createModelMock(name))
    }

    return modelMocks.get(name)!
  }

  function createQueueMock(name: string) {
    const jobs = new Map<string, QueueJobRecord>()

    return {
      add: vi.fn(async (jobName: string, data: Record<string, any>, opts: Record<string, any> = {}) => {
        const now = Date.now()
        const id = String(opts['jobId'] || `${name}:${jobs.size + 1}`)
        const job: QueueJobRecord = {
          id,
          name: jobName,
          data,
          opts,
          attemptsMade: 0,
          timestamp: now,
          delay: Number(opts['delay'] || 0),
          finishedOn: null,
          progress: 0,
          returnvalue: [],
          getState: vi.fn().mockResolvedValue('waiting'),
        }
        jobs.set(id, job)
        return job
      }),
      client: Promise.resolve({
        ping: vi.fn().mockResolvedValue('PONG'),
      }),
      getJob: vi.fn(async (jobId: string) => jobs.get(jobId) || null),
      getJobCounts: vi.fn().mockResolvedValue({
        active: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        prioritized: 0,
      }),
      getJobs: vi.fn(async () => Array.from(jobs.values())),
      name,
    }
  }

  function getOrCreateQueueMock(name: string) {
    if (!queueMocks.has(name)) {
      queueMocks.set(name, createQueueMock(name))
    }

    return queueMocks.get(name)!
  }

  function createConnectionMock() {
    return {
      db: {
        admin: () => ({
          command: vi.fn().mockResolvedValue({ ok: 1 }),
        }),
      },
    }
  }

  function createNamedClass(name: string) {
    return {
      [name]: class {},
    }[name]
  }

  function createEnum(values: string[]) {
    return Object.freeze(
      Object.fromEntries(values.map(value => [value, value.toLowerCase()])),
    )
  }

  const mongoEnumMocks: Record<string, Record<string, string>> = {
    BillingMode: createEnum(['QUOTA', 'POSTPAID', 'BYOK']),
    BrandAssetType: createEnum(['LOGO', 'COLOR_PALETTE', 'FONT', 'IMAGE', 'VIDEO']),
    CampaignStatus: createEnum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED']),
    ClawHostHealthStatus: createEnum(['HEALTHY', 'DEGRADED', 'OFFLINE']),
    ClawHostInstanceStatus: createEnum(['RUNNING', 'STOPPED', 'FAILED']),
    DistributionRuleType: createEnum(['BY_EMPLOYEE', 'BY_PLATFORM', 'BY_DIMENSION']),
    EmployeeAssignmentStatus: createEnum(['ACTIVE', 'PAUSED', 'DISABLED']),
    MarketplaceCurrency: createEnum(['CNY', 'USD']),
    McUserType: createEnum(['INDIVIDUAL', 'ENTERPRISE']),
    NotificationChannel: createEnum(['EMAIL', 'WEBHOOK', 'SMS', 'WECHAT']),
    NotificationEvent: createEnum([
      'TASK_COMPLETED',
      'TASK_FAILED',
      'CONTENT_PENDING_REVIEW',
      'CONTENT_APPROVED',
      'CONTENT_REJECTED',
      'CONTENT_CHANGES_REQUESTED',
      'CONTENT_PUBLISHED',
      'SUBSCRIPTION_EXPIRING',
      'CREDIT_LOW',
    ]),
    OrgApiKeyProvider: createEnum(['KLING', 'GEMINI', 'DEEPSEEK', 'OPENAI', 'TIKHUB', 'VCE']),
    OrgStatus: createEnum(['ACTIVE', 'SUSPENDED', 'TRIAL']),
    OrgType: createEnum(['INDIVIDUAL', 'TEAM', 'PROFESSIONAL', 'ENTERPRISE']),
    PackStatus: createEnum(['ACTIVE', 'DEPLETED', 'EXPIRED', 'REFUNDED']),
    PackType: createEnum(['SINGLE', 'PACK_10', 'PACK_30', 'PACK_100', 'TRIAL_FREE', 'ENTERPRISE_MONTHLY']),
    PaymentMethod: createEnum(['WECHAT_NATIVE', 'WECHAT_JSAPI', 'ALIPAY']),
    PaymentProductType: createEnum(['VIDEO_PACK', 'SUBSCRIPTION', 'ADDON']),
    PaymentStatus: createEnum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'EXPIRED']),
    PipelineStatus: createEnum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    PipelineType: createEnum(['UGC', 'ADS', 'TEMPLATE']),
    PlatformAccountPlatform: createEnum(['DOUYIN', 'XIAOHONGSHU', 'KUAISHOU', 'BILIBILI']),
    PlatformAccountStatus: createEnum(['ACTIVE', 'INACTIVE']),
    ProductionBatchStatus: createEnum(['PENDING', 'PROCESSING', 'PAUSED', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED']),
    ReportStatus: createEnum(['PENDING', 'READY', 'FAILED']),
    ReportType: createEnum(['WEEKLY', 'MONTHLY', 'CAMPAIGN', 'CUSTOM']),
    SubscriptionPlan: createEnum(['TEAM', 'PRO', 'FLAGSHIP']),
    SubscriptionStatus: createEnum(['ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']),
    UsageHistoryType: createEnum([
      'VIDEO_CHARGE',
      'VIDEO_REFUND',
      'TOKEN_USAGE',
      'COPY_GENERATION',
      'VIRAL_ANALYSIS',
      'REMIX_BRIEF',
    ]),
    UserRole: createEnum(['ADMIN', 'EDITOR', 'VIEWER']),
    VideoTaskStatus: createEnum([
      'DRAFT',
      'PENDING',
      'ANALYZING',
      'EDITING',
      'RENDERING',
      'QUALITY_CHECK',
      'GENERATING_COPY',
      'COMPLETED',
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'PUBLISHED',
      'FAILED',
      'CANCELLED',
    ]),
    VideoTaskApprovalAction: createEnum([
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'CHANGES_REQUESTED',
      'PUBLISHED',
    ]),
    VideoTaskType: createEnum(['BRAND_REPLACE', 'REMIX', 'NEW_CONTENT']),
    ViralContentRemixStatus: createEnum(['PENDING', 'REMIXED', 'SKIPPED']),
  }

  return {
    createConnectionMock,
    createEnum,
    createNamedClass,
    getModelToken,
    getOrCreateModelMock,
    getOrCreateQueueMock,
    getQueueToken,
    mongoEnumMocks,
    mongooseConnectionToken,
  }
})

vi.mock('@yikart/aitoearn-auth', async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({}))
  const { createParamDecorator } = await import('@nestjs/common')

  return {
    ...actual,
    GetToken: () => createParamDecorator((_data, ctx) => ctx.switchToHttp().getRequest().user)(),
    Internal: () => () => undefined,
    Public: () => () => undefined,
  }
})

vi.mock('@yikart/mongodb', () => {
  const entityNames = [
    'ApiKey',
    'ApiUsage',
    'AuditLog',
    'Brand',
    'BrandAssetVersion',
    'Campaign',
    'ClawHostInstalledSkill',
    'ClawHostInstance',
    'ClawHostInstanceConfig',
    'Competitor',
    'CopyHistory',
    'DistributionRule',
    'EmployeeAssignment',
    'Invoice',
    'MarketplaceTemplate',
    'MediaClawUser',
    'Notification',
    'NotificationConfig',
    'Organization',
    'PaymentOrder',
    'ProductionBatch',
    'Pipeline',
    'PipelineTemplate',
    'PlatformAccount',
    'PublishRecord',
    'Report',
    'Subscription',
    'UsageHistory',
    'VideoAnalytics',
    'VideoPack',
    'VideoTask',
    'ViralContent',
    'Webhook',
  ] as const

  const schemaNames = [
    'ApiKeySchema',
    'ApiUsageSchema',
    'AuditLogSchema',
    'BrandAssetVersionSchema',
    'BrandSchema',
    'CampaignSchema',
    'ClawHostInstanceSchema',
    'CompetitorSchema',
    'CopyHistorySchema',
    'DistributionRuleSchema',
    'EmployeeAssignmentSchema',
    'InvoiceSchema',
    'MarketplaceTemplateSchema',
    'MediaClawUserSchema',
    'NotificationConfigSchema',
    'OrganizationSchema',
    'PaymentOrderSchema',
    'ProductionBatchSchema',
    'PipelineSchema',
    'PipelineTemplateSchema',
    'PlatformAccountSchema',
    'PublishRecordSchema',
    'ReportSchema',
    'SubscriptionSchema',
    'UsageHistorySchema',
    'VideoAnalyticsSchema',
    'VideoPackSchema',
    'VideoTaskSchema',
    'ViralContentSchema',
    'WebhookSchema',
  ] as const

  const mockModule: Record<string, any> = {
    ...testingHarness.mongoEnumMocks,
  }

  for (const entityName of entityNames) {
    mockModule[entityName] = testingHarness.createNamedClass(entityName)
  }

  for (const schemaName of schemaNames) {
    mockModule[schemaName] = {}
  }

  return mockModule
})

vi.mock('@bull-board/api', () => ({
  createBullBoard: vi.fn(),
}))

vi.mock('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: class BullMQAdapter {
    constructor(public readonly queue: unknown) {}
  },
}))

vi.mock('@bull-board/express', () => ({
  ExpressAdapter: class ExpressAdapter {
    private basePath = '/'

    setBasePath(path: string) {
      this.basePath = path
    }

    getRouter() {
      return {
        basePath: this.basePath,
      }
    }
  },
}))

vi.mock('@nestjs/mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nestjs/mongoose')>()

  class MockMongooseModule {
    static forFeature(models: Array<{ name: string }>) {
      const providers = [
        {
          provide: testingHarness.mongooseConnectionToken,
          useValue: testingHarness.createConnectionMock(),
        },
        ...models.map(({ name }) => ({
          provide: testingHarness.getModelToken(name),
          useValue: testingHarness.getOrCreateModelMock(name),
        })),
      ]

      return {
        module: MockMongooseModule,
        providers,
        exports: providers.map(provider => provider.provide),
      }
    }
  }

  return {
    ...actual,
    InjectConnection: () => Inject(testingHarness.mongooseConnectionToken),
    InjectModel: (name: string) => Inject(testingHarness.getModelToken(name)),
    MongooseModule: MockMongooseModule,
    getConnectionToken: () => testingHarness.mongooseConnectionToken,
    getModelToken: testingHarness.getModelToken,
  }
})

vi.mock('@nestjs/bullmq', () => {
  class MockBullModule {
    static registerQueue(...configs: Array<{ name: string }>) {
      const providers = configs.map(config => ({
        provide: testingHarness.getQueueToken(config.name),
        useValue: testingHarness.getOrCreateQueueMock(config.name),
      }))

      return {
        module: MockBullModule,
        providers,
        exports: providers.map(provider => provider.provide),
      }
    }
  }

  return {
    BullModule: MockBullModule,
    InjectQueue: (name: string) => Inject(testingHarness.getQueueToken(name)),
    OnWorkerEvent: () => () => undefined,
    Processor: () => () => undefined,
    WorkerHost: class WorkerHost {},
    getQueueToken: testingHarness.getQueueToken,
  }
})

vi.mock('@nestjs/jwt', () => {
  class MockJwtService {
    sign = vi.fn(() => 'mock-jwt-token')
    signAsync = vi.fn(async () => 'mock-jwt-token')
    verify = vi.fn(() => ({ id: 'user-1' }))
    verifyAsync = vi.fn(async () => ({ id: 'user-1' }))
  }

  class MockJwtModule {
    static register() {
      return {
        module: MockJwtModule,
        providers: [MockJwtService],
        exports: [MockJwtService],
      }
    }
  }

  return {
    JwtModule: MockJwtModule,
    JwtService: MockJwtService,
  }
})

vi.mock('@nestjs/throttler', () => {
  class MockThrottlerGuard {
    async canActivate() {
      return true
    }
  }

  class MockThrottlerModule {
    static forRoot() {
      return {
        module: MockThrottlerModule,
      }
    }
  }

  return {
    Throttle: () => () => undefined,
    ThrottlerGuard: MockThrottlerGuard,
    ThrottlerModule: MockThrottlerModule,
  }
})

vi.mock('@nestjs/terminus', () => {
  class MockHealthCheckService {
    async check(indicators: Array<() => Promise<Record<string, any>>>) {
      const details = Object.assign({}, ...(await Promise.all(indicators.map(indicator => indicator()))))
      return {
        status: 'ok',
        info: details,
        error: {},
        details,
      }
    }
  }

  class MockDiskHealthIndicator {
    async checkStorage(name: string) {
      return {
        [name]: {
          status: 'up',
        },
      }
    }
  }

  class MockMemoryHealthIndicator {
    async checkHeap(name: string) {
      return {
        [name]: {
          status: 'up',
        },
      }
    }
  }

  class MockHealthCheckError extends Error {
    constructor(message: string, public readonly causes: Record<string, any>) {
      super(message)
    }
  }

  class MockTerminusModule {}

  return {
    DiskHealthIndicator: MockDiskHealthIndicator,
    HealthCheck: () => () => undefined,
    HealthCheckError: MockHealthCheckError,
    HealthCheckService: MockHealthCheckService,
    MemoryHealthIndicator: MockMemoryHealthIndicator,
    TerminusModule: MockTerminusModule,
  }
})

export interface ModuleSpecOptions<TService> {
  controller?: Type<unknown>
  keyMethods: Array<keyof TService & string>
  module: Type<unknown>
  overrides?: Array<{
    provide: unknown
    useValue: unknown
  }>
  service: Type<TService>
  suiteName: string
}

export function describeModuleSpec<TService>({
  controller,
  keyMethods,
  module,
  overrides,
  service,
  suiteName,
}: ModuleSpecOptions<TService>) {
  function createUnknownTokenMock(token: unknown) {
    if (typeof token === 'function') {
      if (token.name === 'HttpAdapterHost') {
        return {
          httpAdapter: {
            getInstance: () => ({
              use: vi.fn(),
            }),
          },
        }
      }

      const prototype = token.prototype as Record<string, unknown> | undefined
      const methods = prototype
        ? Object.getOwnPropertyNames(prototype).filter(method => method !== 'constructor')
        : []

      return Object.fromEntries(methods.map(method => [method, vi.fn()]))
    }

    return {}
  }

  describe(suiteName, () => {
    let serviceInstance: TService
    let moduleRef: TestingModule

    beforeAll(async () => {
      process.env['NODE_ENV'] = 'test'
      process.env['JWT_SECRET'] = process.env['JWT_SECRET'] || 'test-jwt-secret'

      let moduleBuilder = Test.createTestingModule({
        imports: [module],
      })
        .useMocker(createUnknownTokenMock)

      for (const override of overrides || []) {
        moduleBuilder = moduleBuilder.overrideProvider(override.provide).useValue(override.useValue)
      }

      moduleRef = await moduleBuilder.compile()

      serviceInstance = moduleRef.get(service, { strict: false })
    })

    afterAll(async () => {
      await moduleRef?.close()
    })

    it('模块可以完成 bootstrap', () => {
      expect(moduleRef).toBeDefined()
    })

    it('service 可以被注入', () => {
      expect(serviceInstance).toBeDefined()
    })

    if (controller) {
      it('controller 可以被注入', () => {
        expect(moduleRef.get(controller, { strict: false })).toBeDefined()
      })
    }

    it('核心方法可调用', () => {
      for (const method of keyMethods) {
        expect(serviceInstance[method]).toBeTypeOf('function')
      }
    })
  })
}
