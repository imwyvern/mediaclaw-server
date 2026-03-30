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
    return this.assetService.uploadAsset(body.brandId, body.type, {
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
    @Query('brandId') brandId: string,
    @Query('type') type: BrandAssetType,
  ) {
    return this.assetService.getActiveAsset(brandId, type)
  }

  @Get('versions')
  async listVersions(
    @Query('brandId') brandId: string,
    @Query('type') type: BrandAssetType,
  ) {
    return this.assetService.listVersions(brandId, type)
  }

  @Patch(':id/activate')
  async setActive(@Param('id') id: string) {
    return this.assetService.setActive(id)
  }

  @Delete(':id')
  async deleteVersion(@Param('id') id: string) {
    return this.assetService.deleteVersion(id)
  }
}
