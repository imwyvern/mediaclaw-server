import { Module } from '@nestjs/common'
import { ReportModule } from '../report/report.module'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'

@Module({
  imports: [ReportModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
