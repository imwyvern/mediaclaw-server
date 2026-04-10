import AdmZip from 'adm-zip'
import { describe, expect, it, vi } from 'vitest'
import { ExportService } from './export.service'

describe('exportService behavior', () => {
  it('应将多份报表打包成 zip 并附带 manifest', async () => {
    const reportService = {
      generateReport: vi.fn()
        .mockResolvedValueOnce({
          id: 'report-pdf',
          type: 'weekly',
          period: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-04-07T00:00:00.000Z',
          },
          generatedAt: '2026-04-10T10:48:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'report-csv',
          type: 'campaign',
          period: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-04-07T00:00:00.000Z',
          },
          generatedAt: '2026-04-10T10:48:01.000Z',
        }),
      getReportFile: vi.fn()
        .mockResolvedValueOnce({
          contentType: 'application/pdf',
          encoding: 'base64',
          size: 12,
          content: Buffer.from('fake-pdf').toString('base64'),
          url: '/api/v1/reports/report-pdf/files/pdf',
        })
        .mockResolvedValueOnce({
          contentType: 'text/csv; charset=utf-8',
          encoding: 'utf8',
          size: 18,
          content: 'section,label,value',
          url: '/api/v1/reports/report-csv/files/csv',
        }),
    }

    const service = new ExportService(reportService as any)
    const result = await service.exportReport('org-1', {
      format: 'zip',
      reports: [
        {
          type: 'weekly' as any,
          period: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-04-07T00:00:00.000Z',
          },
          format: 'pdf',
        },
        {
          type: 'campaign' as any,
          period: {
            start: '2026-04-01T00:00:00.000Z',
            end: '2026-04-07T00:00:00.000Z',
          },
          format: 'csv',
        },
      ],
    })

    expect(result.format).toBe('zip')
    expect(result.contentType).toBe('application/zip')
    expect(result.encoding).toBe('base64')
    expect(reportService.generateReport).toHaveBeenCalledTimes(2)
    expect(reportService.getReportFile).toHaveBeenCalledTimes(2)

    const archive = new AdmZip(Buffer.from(result.content, 'base64'))
    const entryNames = archive.getEntries().map(entry => entry.entryName).sort()
    expect(entryNames.some(entry => entry.endsWith('.pdf'))).toBe(true)
    expect(entryNames.some(entry => entry.endsWith('.csv'))).toBe(true)
    expect(entryNames).toContain('manifest.json')

    const manifestEntry = archive.getEntries().find(entry => entry.entryName === 'manifest.json')
    const manifest = JSON.parse(manifestEntry?.getData().toString('utf8') || '{}')
    expect(manifest.reports).toHaveLength(2)
    expect(manifest.reports[0]).toEqual(expect.objectContaining({
      id: 'report-pdf',
      format: 'pdf',
    }))
    expect(manifest.reports[1]).toEqual(expect.objectContaining({
      id: 'report-csv',
      format: 'csv',
    }))
  })
})
