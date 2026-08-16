import { AlertTriangle, Check, CircleHelp, X } from 'lucide-react'
import { Badge, Card, Progress } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatBytes, type CheckStatus, type QualityReport } from '@/lib/quality/score'

/**
 * The 3D Readiness Score (§16).
 *
 * Renders only measured values. Where a check could not be evaluated it says
 * "Unknown" — never "No" and never a rounded-up pass. `printReady` is null in
 * exactly that case: glTF carries no manifold declaration, so a definite yes
 * is not available from the file, and inventing one would be the kind of
 * confident wrongness that costs a customer a failed print run.
 */

const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <Check className="text-success size-3.5" aria-hidden />,
  warn: <AlertTriangle className="text-warning size-3.5" aria-hidden />,
  fail: <X className="text-destructive size-3.5" aria-hidden />,
  unknown: <CircleHelp className="text-muted-foreground size-3.5" aria-hidden />,
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  unknown: 'Unknown',
}

function scoreTone(score: number): string {
  if (score >= 85) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-destructive'
}

function Verdict({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value === null ? (
        <Badge variant="muted">Unknown</Badge>
      ) : value ? (
        <Badge variant="success">Yes</Badge>
      ) : (
        <Badge variant="destructive">No</Badge>
      )}
    </div>
  )
}

export default function QualityReportCard({
  report,
  className,
}: {
  report: QualityReport | null
  className?: string
}) {
  if (!report) {
    return (
      <Card className={cn('p-5', className)}>
        <h3 className="text-sm font-semibold">3D Readiness</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Not scored. This model was added before quality checks existed, or its file could not be
          read. Re-upload it to get a report.
        </p>
      </Card>
    )
  }

  if (report.error) {
    return (
      <Card className={cn('border-destructive/40 p-5', className)}>
        <h3 className="text-sm font-semibold">3D Readiness</h3>
        <p className="text-destructive mt-1 text-sm">{report.error}</p>
      </Card>
    )
  }

  const size = report.measured.size

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">3D Readiness</h3>
        <span className="text-muted-foreground text-xs">
          Measured from the file, {new Date(report.scoredAt).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground text-xs">Model quality</span>
            <span className={cn('text-sm font-semibold tabular-nums', scoreTone(report.modelQuality))}>
              {report.modelQuality}%
            </span>
          </div>
          <Progress value={report.modelQuality} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground text-xs">Mobile performance</span>
            <span
              className={cn('text-sm font-semibold tabular-nums', scoreTone(report.mobilePerformance))}
            >
              {report.mobilePerformance}%
            </span>
          </div>
          <Progress value={report.mobilePerformance} />
        </div>
      </div>

      <div className="mt-4 divide-y border-y">
        <Verdict label="AR ready" value={report.arReady} />
        <Verdict label="Web ready" value={report.webReady} />
        <Verdict label="Print ready" value={report.printReady} />
      </div>
      {report.printReady === null && (
        <p className="text-muted-foreground mt-2 text-xs">
          Printability needs watertight geometry, which a glTF file does not declare. GENIE will not
          guess — check it in your slicer.
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Triangles</dt>
          <dd className="font-medium tabular-nums">
            {report.measured.triangleCount.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">File</dt>
          <dd className="font-medium tabular-nums">{formatBytes(report.measured.fileBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Textures</dt>
          <dd className="font-medium tabular-nums">{formatBytes(report.measured.textureBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Real size</dt>
          <dd className="font-medium tabular-nums">
            {size
              ? `${(size.x * 100).toFixed(0)}×${(size.y * 100).toFixed(0)}×${(size.z * 100).toFixed(0)} cm`
              : 'Unknown'}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2">
        {report.checks.map((check) => (
          <li key={check.id} className="flex gap-2.5 text-sm">
            <span className="mt-0.5 shrink-0" title={STATUS_LABEL[check.status]}>
              {STATUS_ICON[check.status]}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{check.label}</span>{' '}
              <span className="text-muted-foreground">— {check.detail}</span>
              {check.advice && (
                <span className="text-muted-foreground block text-xs">{check.advice}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Compact one-line variant for list rows. */
export function QualityPill({ report }: { report: QualityReport | null }) {
  if (!report || report.error) return <Badge variant="muted">Not scored</Badge>
  if (!report.arReady) return <Badge variant="warning">{report.modelQuality}% · not AR ready</Badge>
  return <Badge variant="success">{report.modelQuality}% · AR ready</Badge>
}
