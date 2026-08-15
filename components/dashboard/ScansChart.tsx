'use client'

import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { DailyPoint } from '@/lib/db/repositories/analytics'

/**
 * Daily activity chart.
 *
 * Colours come from the chart tokens, so the series stay distinguishable and
 * consistent in both light and dark themes rather than being hardcoded hexes.
 */
export default function ScansChart({ data }: { data: DailyPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    // "12 Aug" — full ISO dates crowd a 30-point axis on mobile.
    label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }),
  }))

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="scansFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="arFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            // Thin the labels so they never overlap on a narrow screen.
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--color-popover-foreground)',
            }}
            labelStyle={{ color: 'var(--color-muted-foreground)', marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="scans"
            name="Scans"
            stroke="var(--color-chart-1)"
            strokeWidth={2}
            fill="url(#scansFill)"
          />
          <Area
            type="monotone"
            dataKey="arSessions"
            name="AR sessions"
            stroke="var(--color-chart-2)"
            strokeWidth={2}
            fill="url(#arFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
