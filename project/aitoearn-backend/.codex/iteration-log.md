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
