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
