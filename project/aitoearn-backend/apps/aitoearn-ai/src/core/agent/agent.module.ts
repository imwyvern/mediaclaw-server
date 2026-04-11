import { Module } from '@nestjs/common'
import { AitoearnServerClientModule } from '@yikart/aitoearn-server-client'
import { HelpersModule } from '@yikart/helpers'
import { config } from '../../config'
import { AideoModule } from '../ai/aideo'
import { ChatModule } from '../ai/chat'
import { ImageModule } from '../ai/image'
import { VideoModule } from '../ai/video'
import { AgentProductController } from './agent-product.controller'
import { AgentTaskTimeoutScheduler } from './agent-task-timeout.scheduler'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'
import { ClaudeCodeRouterModule } from './claude-code-router/claude-code-router.module'
import { ImageEditMcp } from './mcp/image-edit.mcp'
import { MediaMcp } from './mcp/media.mcp'
import { SubtitleMcp } from './mcp/subtitle.mcp'
import { UtilMcp } from './mcp/util.mcp'
import { VideoUtilsMcp } from './mcp/video-utils.mcp'
import { AideoMcp } from './mcp/volcengine/aideo.mcp'
import { DramaRecapMcp } from './mcp/volcengine/drama-recap.mcp'
import { StyleTransferMcp } from './mcp/volcengine/style-transfer.mcp'
import { VideoEditMcp } from './mcp/volcengine/video-edit.mcp'
import { AgentMemoryService } from './services/agent-memory.service'
import { AgentObservabilityService } from './services/agent-observability.service'
import { AgentOrchestrationService } from './services/agent-orchestration.service'
import { AgentProductOrchestratorService } from './services/agent-product-orchestrator.service'
import { AgentProductService } from './services/agent-product.service'
import { AgentRegistryService } from './services/agent-registry.service'
import { AgentRoleRegistryService } from './services/agent-role-registry.service'
import { AgentRuntimeService } from './services/agent-runtime.service'
import { AgentToolLayerService } from './services/agent-tool-layer.service'
import { AgentVersioningService } from './services/agent-versioning.service'
import { SkillInitService } from './skill-init.service'

@Module({
  imports: [
    HelpersModule,
    ChatModule,
    ImageModule,
    VideoModule,
    AideoModule,
    ClaudeCodeRouterModule,
    AitoearnServerClientModule.forRoot(config.serverClient),
  ],
  controllers: [AgentController, AgentProductController],
  providers: [
    AgentService,
    AgentProductService,
    MediaMcp,
    AideoMcp,
    UtilMcp,
    VideoEditMcp,
    AgentTaskTimeoutScheduler,
    DramaRecapMcp,
    StyleTransferMcp,
    VideoUtilsMcp,
    ImageEditMcp,
    SubtitleMcp,
    SkillInitService,
    AgentMemoryService,
    AgentRegistryService,
    AgentVersioningService,
    AgentObservabilityService,
    AgentRoleRegistryService,
    AgentToolLayerService,
    AgentOrchestrationService,
    AgentProductOrchestratorService,
    AgentRuntimeService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
