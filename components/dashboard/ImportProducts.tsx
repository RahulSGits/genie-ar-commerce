'use client'

import { useActionState, useRef, useState } from 'react'
import { Download, FileUp, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, Badge, Button, Card, Table, TBody, TD, TH, THead, TR } from '@/components/ui'
import { previewImportAction, commitImportAction } from '@/lib/actions/workflow'
import { COLUMN_HELP, IMPORT_COLUMNS, importTemplateCsv } from '@/lib/import/csv'
import { formatMoney, type CurrencyCode } from '@/utils/money'

/**
 * CSV import (§46).
 *
 * Two steps on purpose: the file is parsed and shown BEFORE anything is
 * written. A furniture retailer importing 600 SKUs needs to see that column
 * three was read as the price before it becomes 600 wrong products, and an
 * import that silently half-succeeds is worse than one that refuses.
 *
 * The commit re-parses the same file server-side rather than trusting rows
 * posted back from here, so what gets written is what the CSV says.
 */
export default function ImportProducts({ currency }: { currency: CurrencyCode }) {
  const [preview, previewAction, previewing] = useActionState(previewImportAction, null)
  const [commit, commitAction, committing] = useActionState(commitImportAction, null)
  const [fileName, setFileName] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const downloadTemplate = () => {
    const blob = new Blob([importTemplateCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'genie-product-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Template downloaded.')
  }

  const rows = preview?.ok ? preview.data.rows : []
  const errors = preview?.ok ? preview.data.errors : []
  const unknown = preview?.ok ? preview.data.unknownColumns : []
  const missing = preview?.ok ? preview.data.missingRequired : []

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">1 — Choose your file</h2>
            <p className="text-muted-foreground text-sm">
              A .csv exported from a spreadsheet, POS or store. Up to 1,000 rows and 5 MB.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            <Download className="size-4" aria-hidden />
            Template
          </Button>
        </div>

        <form ref={formRef} action={previewAction} className="mt-4 space-y-3">
          <label className="hover:bg-accent/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors">
            <FileUp className="text-muted-foreground/60 size-7" aria-hidden />
            <span className="text-sm font-medium">
              {fileName ?? 'Choose a CSV file'}
            </span>
            <span className="text-muted-foreground text-xs">Nothing is saved until you confirm</span>
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="sr-only"
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? null)
                // Preview immediately — an extra click before seeing anything
                // is friction for no benefit.
                formRef.current?.requestSubmit()
              }}
            />
          </label>

          {previewing && <p className="text-muted-foreground text-sm">Reading your file…</p>}
          {preview?.ok === false && (
            <p className="text-destructive text-sm" role="alert">
              {preview.error}
            </p>
          )}
        </form>
      </Card>

      {preview?.ok && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">2 — Check what we read</h2>

          {missing.length > 0 && (
            <Alert variant="destructive" className="mt-3">
              Missing required column{missing.length === 1 ? '' : 's'}:{' '}
              <strong>{missing.join(', ')}</strong>. Nothing can be imported without it.
            </Alert>
          )}

          {unknown.length > 0 && (
            <Alert variant="warning" className="mt-3">
              Ignored {unknown.length} column{unknown.length === 1 ? '' : 's'} GENIE does not use:{' '}
              <span className="font-mono text-xs">{unknown.join(', ')}</span>
            </Alert>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={rows.length > 0 ? 'success' : 'muted'}>
              {rows.length} row{rows.length === 1 ? '' : 's'} ready
            </Badge>
            {errors.length > 0 && (
              <Badge variant="destructive">
                {errors.length} row{errors.length === 1 ? '' : 's'} skipped
              </Badge>
            )}
          </div>

          {errors.length > 0 && (
            <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i} className="flex gap-2">
                  <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {e.line > 0 && <strong>Line {e.line}</strong>}
                    {e.line > 0 && e.column && ` · ${e.column}`}
                    {e.line > 0 && ' — '}
                    {e.message}
                  </span>
                </li>
              ))}
              {errors.length > 8 && <li>…and {errors.length - 8} more.</li>}
            </ul>
          )}

          {rows.length > 0 && (
            <div className="mt-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>SKU</TH>
                    <TH>Price</TH>
                    <TH>Category</TH>
                    <TH>Size</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.slice(0, 12).map((r) => (
                    <TR key={r.line}>
                      <TD className="font-medium">{r.name}</TD>
                      <TD className="text-muted-foreground text-xs">{r.sku ?? '—'}</TD>
                      <TD className="tabular-nums">
                        {r.priceMinor === null
                          ? '—'
                          : formatMoney({ amount: r.priceMinor, currency })}
                      </TD>
                      <TD className="text-muted-foreground text-xs">{r.category ?? '—'}</TD>
                      <TD className="text-muted-foreground text-xs">
                        {r.dimWidth && r.dimHeight && r.dimDepth
                          ? `${r.dimWidth}×${r.dimHeight}×${r.dimDepth} cm`
                          : '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {rows.length > 12 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  Showing the first 12 of {rows.length}.
                </p>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <form action={commitAction} className="mt-4">
              {/*
                The file is submitted again rather than the parsed rows: the
                server re-reads it, so a tampered payload cannot smuggle a
                different product past the preview that was approved.
              */}
              <input
                type="file"
                name="file"
                className="sr-only"
                ref={(el) => {
                  const source = formRef.current?.querySelector<HTMLInputElement>('input[type=file]')
                  if (el && source?.files) el.files = source.files
                }}
              />
              <Button type="submit" disabled={committing}>
                {committing ? 'Importing…' : `Import ${rows.length} product${rows.length === 1 ? '' : 's'} as drafts`}
              </Button>
              <p className="text-muted-foreground mt-2 text-xs">
                Everything imports as a draft. Nothing goes live until you publish it.
              </p>
            </form>
          )}
        </Card>
      )}

      {commit?.ok && (
        <Alert variant="success">
          Imported {commit.data.created} product{commit.data.created === 1 ? '' : 's'}.
          {commit.data.skipped > 0 && ` ${commit.data.skipped} skipped.`}
          {commit.data.reasons.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {commit.data.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {commit?.ok === false && (
        <Alert variant="destructive" role="alert">
          {commit.error}
        </Alert>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Columns GENIE reads</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Header names are matched loosely — <span className="font-mono">Image URL</span> and{' '}
          <span className="font-mono">image_url</span> are the same column. Anything else is ignored.
        </p>
        <dl className="mt-3 space-y-2 text-xs">
          {IMPORT_COLUMNS.map((column) => (
            <div key={column} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="w-28 shrink-0 font-mono font-medium">{column}</dt>
              <dd className="text-muted-foreground">{COLUMN_HELP[column]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  )
}
