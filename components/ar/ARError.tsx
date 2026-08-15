'use client'

import Link from 'next/link'

export default function ARError({
  title = 'Unable to load the 3D dish.',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry: () => void
}) {
  return (
    <div className="ar-screen ar-screen-dark">
      <div className="ar-screen-inner">
        <div className="ar-icon-badge" aria-hidden>
          ⚠
        </div>
        <h2 className="ar-screen-title">{title}</h2>
        {message && <p className="ar-screen-body">{message}</p>}

        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/">
          Back to menu
        </Link>
      </div>
    </div>
  )
}
