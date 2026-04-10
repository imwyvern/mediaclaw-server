import { BadRequestException, Injectable } from '@nestjs/common'
import { ReportType } from '@yikart/mongodb'
import AdmZip from 'adm-zip'
import { ReportAssetFormat, ReportService } from '../report/report.service'

type ExportReportFormat = Exclude<ReportAssetFormat, 'markdown'> | 'zip'
type SingleExportReportFormat = Exclude<ExportReportFormat, 'zip'>

interface ExportReportPeriodInput {
  start: string
  end: string
}

interface ExportReportItemInput {
  type: ReportType
  period: ExportReportPeriodInput
  format?: SingleExportReportFormat
}

interface ExportReportInput {
  format: ExportReportFormat
  type?: ReportType
  period?: ExportReportPeriodInput
  reports?: ExportReportItemInput[]
}

@Injectable()
export class ExportService {
  constructor(private readonly reportService: ReportService) {}

  async exportReport(orgId: string, input: ExportReportInput) {
    if (input.format === 'zip') {
      return this.bundleReports(orgId, input.reports || [])
    }

    if (!input.type || !input.period) {
      throw new BadRequestException('type and period are required')
    }

    const report = await this.reportService.generateReport(
      orgId,
      input.type,
      input.period,
      {
        formats: [input.format],
        waitForCompletion: true,
      },
    )
    const file = await this.reportService.getReportFile(orgId, report.id, input.format)

    return {
      report,
      fileName: this.buildFileName(report.type, report.id, input.format, report.period),
      format: input.format,
      contentType: file.contentType,
      encoding: file.encoding,
      size: file.size,
      content: file.content,
      url: file.url,
    }
  }

  private async bundleReports(orgId: string, reports: ExportReportItemInput[]) {
    if (reports.length === 0) {
      throw new BadRequestException('reports is required when format is zip')
    }

    const zip = new AdmZip()
    const manifest: Array<Record<string, unknown>> = []

    for (const reportRequest of reports) {
      const format = reportRequest.format || 'pdf'
      const report = await this.reportService.generateReport(
        orgId,
        reportRequest.type,
        reportRequest.period,
        {
          formats: [format],
          waitForCompletion: true,
        },
      )
      const file = await this.reportService.getReportFile(orgId, report.id, format)
      const fileName = this.buildFileName(report.type, report.id, format, report.period)

      zip.addFile(fileName, this.toBuffer(file.content, file.encoding))
      manifest.push({
        id: report.id,
        type: report.type,
        format,
        fileName,
        url: file.url,
        generatedAt: report.generatedAt,
      })
    }

    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ reports: manifest }, null, 2), 'utf8'))
    const buffer = zip.toBuffer()

    return {
      format: 'zip',
      fileName: `mediaclaw-report-bundle-${Date.now()}.zip`,
      contentType: 'application/zip',
      encoding: 'base64',
      size: buffer.length,
      content: buffer.toString('base64'),
      reports: manifest,
    }
  }

  private buildFileName(
    type: string,
    reportId: string,
    format: SingleExportReportFormat,
    period?: { start?: string | Date, end?: string | Date },
  ) {
    const start = this.toFileToken(period?.start)
    const end = this.toFileToken(period?.end)
    return `${type}-${start}-${end}-${reportId}.${this.resolveExtension(format)}`
  }

  private resolveExtension(format: SingleExportReportFormat) {
    switch (format) {
      case 'excel':
        return 'xlsx'
      case 'json':
        return 'json'
      case 'csv':
        return 'csv'
      default:
        return 'pdf'
    }
  }

  private toFileToken(value?: string | Date) {
    if (!value) {
      return 'na'
    }

    const rawValue = value instanceof Date ? value.toISOString() : String(value)
    return rawValue.replace(/[^0-9A-Z]+/gi, '-').replace(/^-+|-+$/g, '') || 'na'
  }

  private toBuffer(content: string | null, encoding: 'base64' | 'utf8') {
    if (!content) {
      return Buffer.alloc(0)
    }

    return Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8')
  }
}
