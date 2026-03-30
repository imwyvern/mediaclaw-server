import {
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { GetToken } from '@yikart/aitoearn-auth'
import { BrandAssetType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AssetService } from './asset.service'

@MediaClawApiController('api/v1/assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(
    @GetToken() user: any,
    @UploadedFile() file:
      | {
        originalname?: string
        size?: number
        mimetype?: string
      }
      | undefined,
    @Body() body: {
      brandId: string
      type: BrandAssetType
      fileUrl?: string
      metadata?: Record<string, any>
    },
  ) {
    return this.assetService.uploadAsset(user.orgId || user.id, body.brandId, body.type, {
      fileUrl: body.fileUrl,
      fileName: file?.originalname,
      fileSize: file?.size,
      mimeType: file?.mimetype,
      metadata: body.metadata,
      uploadedBy: user.id,
    })
  }

  @Get()
  async getActiveAsset(
    @GetToken() user: any,
    @Query('brandId') brandId: string,
    @Query('type') type: BrandAssetType,
  ) {
    return this.assetService.getActiveAsset(user.orgId || user.id, brandId, type)
  }

  @Get('versions')
  async listVersions(
    @GetToken() user: any,
    @Query('brandId') brandId: string,
    @Query('type') type: BrandAssetType,
  ) {
    return this.assetService.listVersions(user.orgId || user.id, brandId, type)
  }

  @Patch(':id/activate')
  async setActive(@GetToken() user: any, @Param('id') id: string) {
    return this.assetService.setActive(user.orgId || user.id, id)
  }

  @Delete(':id')
  async deleteVersion(@GetToken() user: any, @Param('id') id: string) {
    return this.assetService.deleteVersion(user.orgId || user.id, id)
  }
}
