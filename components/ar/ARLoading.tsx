'use client'

/**
 * Shown while the dish model is downloading. `percent` of -1 means the server
 * gave no Content-Length, so we show an indeterminate bar rather than inventing
 * a number that jumps.
 */
export default function ARLoading({
  percent,
  label = 'Preparing your AR experience…',
}: {
  percent: number
  label?: string
}) {
  const indeterminate = percent < 0

  return (
    <div className="ar-screen ar-screen-dark">
      <div className="ar-screen-inner">
        <div className="ar-spinner" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <p className="ar-loading-label">{label}</p>
        <div
          className="ar-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        >
          <div
            className={`ar-progress-fill ${indeterminate ? 'is-indeterminate' : ''}`}
            style={indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>
        <p className="ar-loading-sub">
          {indeterminate ? 'Loading 3D dish…' : `Loading 3D dish… ${Math.round(percent)}%`}
        </p>
      </div>
    </div>
  )
}
