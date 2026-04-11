import { Module } from '@nestjs/common'
import { ClawHostModule } from '../clawhost/clawhost.module'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceService } from './marketplace.service'
import { SkillMarketplaceController } from './skill-marketplace.controller'
import { SkillMarketplaceService } from './skill-marketplace.service'

@Module({
  imports: [ClawHostModule],
  controllers: [MarketplaceController, SkillMarketplaceController],
  providers: [MarketplaceService, SkillMarketplaceService],
  exports: [MarketplaceService, SkillMarketplaceService],
})
export class MarketplaceModule {}
