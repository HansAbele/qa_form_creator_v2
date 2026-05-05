---
name: xlsx
description: Assists with creating and formatting Excel exports using exceljs. Use when building export functionality for reports, evaluations, or analytics data.
disable-model-invocation: true
---

# Excel Export with exceljs

You are an expert in creating Excel files with exceljs for data export.

## Project Context

- **Library:** exceljs (not SheetJS/xlsx)
- **Use cases:** Export evaluations, agent reports, analytics data
- **Format:** .xlsx with formatting and multiple sheets

## Basic Export Pattern

```typescript
// src/server/queries/exports.ts
import ExcelJS from 'exceljs'

export async function exportToExcel(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'QA Form Creator'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Evaluations')

  // Define columns
  sheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Agent', key: 'agent', width: 20 },
    { header: 'Evaluator', key: 'evaluator', width: 20 },
    { header: 'Form', key: 'form', width: 25 },
    { header: 'Score', key: 'score', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
  ]

  // Style header row
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } }
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '2563EB' },
  }

  // Add data rows with conditional formatting
  for (const row of data.rows) {
    const addedRow = sheet.addRow({
      date: new Date(row.createdAt),
      agent: row.agentName,
      evaluator: row.evaluatorName,
      form: row.formTitle,
      score: row.score,
      status: row.score >= 70 ? 'PASS' : 'FAIL',
    })

    // Color-code score cell
    const scoreCell = addedRow.getCell('score')
    if (row.score >= 90) {
      scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } }
    } else if (row.score >= 70) {
      scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF9C3' } }
    } else {
      scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }
    }
  }

  // Format date column
  sheet.getColumn('date').numFmt = 'yyyy-mm-dd hh:mm'
  sheet.getColumn('score').numFmt = '0.00'

  // Auto-filter
  sheet.autoFilter = { from: 'A1', to: `F${data.rows.length + 1}` }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
```

## API Route for Download

```typescript
// src/app/api/export/xlsx/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { exportToExcel } from '@/server/queries/exports'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await getExportData(session)
  const buffer = await exportToExcel(data)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="qa-export-${Date.now()}.xlsx"`,
    },
  })
}
```

## Multi-Sheet Report

```typescript
// Summary sheet + detail sheet
const summarySheet = workbook.addWorksheet('Summary')
const detailSheet = workbook.addWorksheet('Details')

// Summary
summarySheet.addRow(['Total Evaluations', totalCount])
summarySheet.addRow(['Average Score', avgScore])
summarySheet.addRow(['Pass Rate', `${passRate}%`])

// Details
detailSheet.columns = [/* ... */]
detailSheet.addRows(detailRows)
```

## Rules

1. Always stream large exports — don't hold entire dataset in memory
2. Always include headers and auto-filter for usability
3. Format dates and numbers properly (numFmt)
4. Color-code scores for visual clarity (green/yellow/red)
5. Include metadata (creator, date) in workbook properties
6. Set appropriate column widths for readability
