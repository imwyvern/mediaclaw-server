# Iteration Log

## 2026-04-10 10:25:39 PDT
- 当前改动：补完 pipeline 质检为 7 维评分体系，新增 `score/checks/warnings` 结构，并让 worker 在任务完成时回写完整质检摘要。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/pipeline/quality-check.service.spec.ts` 通过
- 下一步计划：补素材版本治理的变更通知，把资产上传/激活/删除事件接入通知模块并补行为测试。

## 2026-04-10 10:30:51 PDT
- 当前改动：为资产版本治理补全变更通知，新增素材上传/激活/删除事件，接入 `AssetService -> NotificationService` 旁路通知，并补资产行为测试。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/asset/asset.service.behavior.spec.ts src/core/mediaclaw/asset/asset.service.spec.ts` 通过
- 下一步计划：补内容批量下载和导出闭环，优先做 ZIP 批量下载与 Excel 导出。

## 2026-04-10 10:36:07 PDT
- 当前改动：补全内容管理批量操作闭环，`batch-download` 新增 ZIP 打包，`export` 新增 Excel/ZIP 导出，并补可解析 ZIP/SpreadsheetML 的行为测试。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/content-mgmt/content-mgmt.export.behavior.spec.ts src/core/mediaclaw/content-mgmt/content-mgmt.service.spec.ts src/core/mediaclaw/content-mgmt/content-mgmt.workflow.spec.ts` 通过
- 下一步计划：补 OpenClaw API Key 合约兼容层，先做 customer-scoped key 格式兼容，不主动破坏现有 `mc_live_` 存量 key。

## 2026-04-10 10:45:25 PDT
- 当前改动：补 OpenClaw API Key 合约兼容层，允许 `mc_<scope>_<secret>` customer-scoped key 与现有 `mc_live_ / mc_test_` 共存，并把 usage 归因统一收敛到稳定 prefix，同时补齐测试公共 mock。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/apikey/apikey.service.behavior.spec.ts src/core/mediaclaw/apikey/apikey.service.spec.ts src/core/mediaclaw/usage/usage-tracking.interceptor.spec.ts` 通过
- 下一步计划：继续补报表统一导出与退款闭环，把剩余后端 🔶 项按原子改动逐个收口。

## 2026-04-10 10:50:54 PDT
- 当前改动：补统一导出闭环的验证与依赖治理，为 `report/export` 增加 `csv/json/excel/zip` 行为测试，同时把内容 ZIP 打包链路改成标准 `archiver` import 并补类型声明，消除导出相关 lint 阻塞。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/report/report.service.behavior.spec.ts src/core/mediaclaw/report/report.service.spec.ts src/core/mediaclaw/export/export.service.behavior.spec.ts src/core/mediaclaw/content-mgmt/content-mgmt.export.behavior.spec.ts` 通过
- 下一步计划：继续补支付退款闭环，把退款申请、审核执行、权益回收和通知链路收口到可演示状态。

## 2026-04-10 10:57:07 PDT
- 当前改动：在 Batch 1 汇总验证里发现 `security-audit` 仍使用旧版 API Key mock 与旧格式测试数据，已补齐 `@yikart/mongodb` 的 scoped-key helper mock，并把越权用例改成当前合法的 `mc_<scope>_<secret>` 合约格式。
- 验证结果：
  - `pnpm nx test aitoearn-server -- --run test/security/security-audit.spec.ts` 首轮失败，定位为缺少 `isMediaClawApiKey` mock 导出与测试 key 格式过旧
  - 修复后 `pnpm nx test aitoearn-server -- --run test/security/security-audit.spec.ts` 通过
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run` 通过，`111` 个测试文件、`356` 个测试全部通过
- 下一步计划：Batch 1 后端补完已满足停止条件，整理本批次提交与剩余无关工作树残留，等待进入下一批 gap 收口。

## 2026-04-10 11:20:45 PDT
- 当前改动：补完公开数据删除/合规下线通道的对外追踪闭环。删除申请新增公开 tracking token、公开状态查询接口 `GET /api/v1/compliance/deletion-requests/:requestId/public-status`，并补 `ComplianceService` 行为测试覆盖 token 签发与公开状态查询。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/compliance/compliance.service.spec.ts` 首轮失败，定位为 spec 触发 `@yikart/assets -> ../../../config -> @yikart/channel-db` 运行时依赖链
  - 在 spec 中补齐 `@yikart/mongodb`、`@yikart/assets` 和 `../../../config` mock 后，`pnpm nx test aitoearn-server -- --run src/core/mediaclaw/compliance/compliance.service.spec.ts` 通过
- 下一步计划：进入趋势预测引擎，把 discovery/analytics 的历史数据补成可查询的趋势预测结果与对应 API。

## 2026-04-10 11:31:05 PDT
- 当前改动：补完趋势预测引擎，新增 `TrendPredictionService` 和 `GET /api/v1/analytics/predictions`。预测结果基于 `viral_contents` 的市场热度信号与 `video_analytics` 的跨组织表现信号，输出未来 7 天内容方向、模板建议和最佳发布时间窗口，并补行为测试。
- 验证结果：
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/analytics/trend-prediction.service.behavior.spec.ts` 首轮通过
  - `pnpm nx build aitoearn-server` 首轮失败，定位为 `publishedAt` 经过 `toDate` 后仍可能为 `null`，已通过类型守卫收敛为 `CustomerPerformanceSignal`
  - `pnpm nx lint aitoearn-server` 首轮失败，定位为未用参数和正则捕获组写法问题，已清理签名与正则
  - 修复后 `pnpm nx build aitoearn-server` 通过
  - 修复后 `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - 修复后 `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/analytics/trend-prediction.service.behavior.spec.ts` 通过
- 下一步计划：进入企业 SSO，实现企业级 SSO 配置、登录入口和 callback 闭环，优先打通 OIDC + 企业平台 preset，再补 SAML 支持。

## 2026-04-10 11:48:08 PDT
- 当前改动：补完企业 SSO 闭环，新增 `enterprise_sso_providers` 配置模型、OIDC/SAML provider DTO 与服务，实现 SSO provider 的创建/列举/删除、登录入口、OIDC callback、SAML assertion 登录，以及外部身份与企业成员关系绑定。
- 验证结果：
  - `pnpm nx build aitoearn-server` 首轮失败，定位为 `enterprise-sso.service.ts` 使用了 DOM 全局类型且定义了未使用常量
  - 显式引入 `@xmldom/xmldom` 的 `Document/Element/Node` 类型并删除死常量后，`pnpm nx build aitoearn-server` 通过
  - 修复后 `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/auth/enterprise-sso.service.behavior.spec.ts` 通过，`4` 个测试全部通过
- 下一步计划：进入 ClawHost PostgreSQL 元数据层，实现 `apps/bots/bot_channels/bot_devices` 的同步与测试，再做本批次全量收口。

## 2026-04-10 11:55:26 PDT
- 当前改动：补完 ClawHost PostgreSQL 元数据层，新增 `ClawHostPostgresService`，支持通过 `pg` 自动建表并同步 `apps / bots / bot_channels / bot_devices`，再把同步挂到 `create/connect/heartbeat/start/stop/restart/upgrade/health-check` 等关键状态变更点，并补行为测试。
- 验证结果：
  - `pnpm nx build aitoearn-server` 首轮失败，定位为 `pg` 缺少类型声明
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/clawhost/clawhost-postgres.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.spec.ts` 首轮失败，定位为新增创建实例用例缺少 `find().select().lean()` mock，且断言未对齐 `ownerUserId` 默认参数
  - 添加 `@types/pg`、补齐 query mock 并修正断言后，`pnpm nx build aitoearn-server` 通过
  - 修复后 `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - 修复后 `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/clawhost/clawhost-postgres.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.spec.ts` 通过，`3` 个测试文件、`11` 个测试全部通过
- 下一步计划：执行本批次全量 build/lint/test 收口，确认没有引入新的 failure，然后整理提交结果。

## 2026-04-10 11:57:32 PDT
- 当前改动：在 Batch 2 全量回归中补公共测试工厂的企业 SSO mock，对 `module-spec.factory.ts` 增加 `EnterpriseSsoProvider`、`EnterpriseSsoProviderSchema`、`EnterpriseSsoProtocol`、`EnterpriseSsoProviderType`，修复 `auth/org` 模块 spec 在加载 `McAuthModule` 时的装配失败。
- 验证结果：
  - `pnpm nx test aitoearn-server -- --run` 首轮失败，定位为 `@yikart/mongodb` 公共 mock 缺少企业 SSO 导出，导致 `auth.service.spec.ts` 和 `org.service.spec.ts` 报错
  - 修复后 `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/auth/auth.service.spec.ts src/core/mediaclaw/org/org.service.spec.ts` 通过，`2` 个测试文件、`8` 个测试全部通过
- 下一步计划：重跑 `aitoearn-server` 全量 build/lint/test，确认 Batch 2 达到停止条件并整理提交。

## 2026-04-10 12:15:10 PDT
- 当前改动：完成 ClawHost runtime 架构升级。把单体 `dockerode` 实现拆成 `docker/k8s` 两个 driver，引入 `runtimeKind` 按实例持久化，支持通过 `MEDIACLAW_CLAWHOST_RUNTIME=docker|k8s` 选择运行时；`k8s` driver 使用真实 `kubectl` 创建 namespace、PVC、Deployment、Service，并把启停、重启、升级、日志、健康检查统一收敛到 runtime 抽象。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/clawhost/clawhost-runtime.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost-postgres.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.spec.ts` 首轮失败，定位为 `module-spec.factory` 装配下 `ClawHostRuntimeService` 未拿到新增 driver provider
  - 对 `ClawHostRuntimeService` 增加 `@Optional()` 注入兜底后，定向测试通过，`4` 个测试文件、`14` 个测试全部通过
- 下一步计划：进入监控链路升级，补 OpenTelemetry tracing 初始化与 Mongo 慢查询观测，并把告警/指标串起来。

## 2026-04-10 12:23:30 PDT
- 当前改动：补完监控链路升级，新增 OpenTelemetry tracing 初始化、中间件级请求 span、响应 trace header 回传，以及 MongoDB 慢查询监控插件与指标接入；同时修正慢查询 payload 截断逻辑，避免 JSON 截断导致运行时异常。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 首轮失败，定位为 `monitoring-tracing.service.behavior.spec.ts` 结尾括号缺失导致解析错误
  - 修复 spec 语法错误后，`pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/health/monitoring-metrics.service.behavior.spec.ts src/core/mediaclaw/health/monitoring-tracing.service.behavior.spec.ts src/core/mediaclaw/health/monitoring-alert.service.behavior.spec.ts` 首轮失败，定位为同一 spec 解析错误
  - 修复后定向测试通过，`3` 个测试文件、`3` 个测试全部通过
- 下一步计划：进入 Batch 3 最后一个原子改动，补备份/存储策略的 OSS 生命周期同步与校验，再做全量 build/lint/test 收口。

## 2026-04-10 12:30:28 PDT
- 当前改动：补完数据备份与存储策略的 OSS 生命周期同步与校验。新增 `StorageLifecycleService` 和 OSS client factory，支持按 bucket 聚合下发生命周期规则、校验 backup/video 规则是否漂移，并把状态接入 `health/storage`；同时把 `backup.sh` 的 Mongo 日备默认保留天数从 7 调整为 30，对齐 PRD。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 首轮失败，定位为 `parseBucketUrl` 使用了会触发超线性回溯告警的正则
  - 改为 `URL` 解析 bucket URL，并把规则比较从 `JSON.stringify` 全对象比较改成字段级比较后，`pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/health/storage-lifecycle.service.behavior.spec.ts src/core/mediaclaw/health/health.service.spec.ts` 首轮失败，定位为视频规则校验误用对象序列化，属性顺序差异导致 false negative
  - 修复后定向测试通过，`2` 个测试文件、`6` 个测试全部通过
- 下一步计划：Batch 3 的原子改动已补齐，接下来执行全量 build/lint/test 收口，确认没有引入新的 failure，再整理本批次提交结果。

## 2026-04-10 12:31:48 PDT
- 当前改动：执行 Batch 3 全量收口验证，确认 ClawHost 多 runtime、OpenTelemetry tracing、Mongo 慢查询监控、OSS 生命周期同步四组架构升级没有引入新的回归。
- 验证结果：
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run` 通过，`119` 个测试文件、`377` 个测试全部通过
  - 功能自测结论：Batch 3 新增的 `clawhost runtime abstraction`、`monitoring tracing + slow query metrics`、`storage lifecycle policy sync` 均已被定向与全量测试覆盖，满足停止条件
- 下一步计划：Batch 3 已完成，整理提交结果并向用户汇报；保留无关残留 `tts.service.ts` 与 `.tmp-vitest/` 不做处理。

## 2026-04-10 12:55:25 PDT
- 当前改动：补完 Gateway 实时推送与 heartbeat 配置更新闭环。新增 `ClawHostGatewayPushService`，支持实例级 gateway 配置、按 capability 实时调用客户端 `/tools/invoke`、heartbeat 配置更新下发，以及在员工分发完成后向 Skill 侧推送 `delivery.pending` 实时事件。
- 验证结果：
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/clawhost/clawhost-gateway-push.service.behavior.spec.ts src/core/mediaclaw/clawhost/clawhost.service.behavior.spec.ts src/core/mediaclaw/health/health.service.behavior.spec.ts src/core/mediaclaw/employee-dispatch/employee-dispatch.service.behavior.spec.ts` 首轮失败，定位为 `axiosPost` mock 未使用 `vi.hoisted` 导致初始化顺序错误
  - 修复 `axios` mock hoist 后，定向测试通过，`4` 个测试文件、`14` 个测试全部通过
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run` 通过，`121` 个测试文件、`381` 个测试全部通过
  - 功能自测结论：实例 gateway 配置可保存并回显，heartbeat 能收到真实 `configUpdates`，员工分发成功后会触发 gateway `delivery.pending` 推送
- 下一步计划：提交本次 Gateway 原子改动，然后进入“个人共享群体验 API 入口”，补齐个人体验版共享实例的产品化配置与查询接口。

## 2026-04-10 13:03:27 PDT
- 当前改动：补完个人共享群体验 API 入口。为 `ClawHostInstance` 新增 `sharedExperienceConfig` 配置模型，支持平台配置官方群渠道、欢迎语、默认入口和客服信息；新增 `PersonalSharedExperienceService` 与 `/api/v1/auth/personal/shared-experience*` 接口，个人体验版用户可查询共享实例目录、激活共享会话并拿到稳定 `sessionId` 与剩余视频包余额。
- 验证结果：
  - `pnpm nx test aitoearn-server -- --run src/core/mediaclaw/clawhost/clawhost.service.behavior.spec.ts src/core/mediaclaw/auth/personal-shared-experience.service.behavior.spec.ts src/core/mediaclaw/auth/auth.service.spec.ts` 首轮失败，定位为共享体验激活用例未 mock `find().sort().limit().lean()` 链路
  - 补齐 `clawHostInstanceModel.find` query mock 后，定向测试通过，`3` 个测试文件、`13` 个测试全部通过
  - `pnpm nx build aitoearn-server` 通过
  - `pnpm nx lint aitoearn-server` 通过，无新增 warning
  - `pnpm nx test aitoearn-server -- --run` 通过，`122` 个测试文件、`384` 个测试全部通过
  - 功能自测结论：实例可配置共享群入口，个人用户可读取目录并激活体验，会话绑定会持久化到用户侧并回写实例最近激活时间
- 下一步计划：进入 SLA 服务化接口，实现 SLA 分档、周期快照、赔付评估与对外查询 API，并在完成后再做一次全量 build/lint/test 收口。
