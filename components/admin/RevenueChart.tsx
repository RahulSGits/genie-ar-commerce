'use client'

import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { formatMoney } from '@/utils/money'

/**
 * Collected revenue by month.
 *
 * Bars rather than an area: monthly collection is a set of discrete totals, and
 * a continuous line would imply revenue accruing between the points.
 */
export default function RevenueChart({
  data,
}: {
  data: Array<{ month: string; amountMinor: number }>
}) {
  const formatted = data.map((d) => ({
    ...d,
    // "Aug 25" — the year matters across a 12-month window.
    label: new Date(`${d.month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }),
  }))

  // Recharts derives axis ticks from the domain, so they can land off-integer.
  const asMoney = (value: number) =>
    formatMoney({ amount: Math.round(value), currency: 'INR' }, { showDecimals: false })

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={asMoney}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
            formatter={(value) => asMoney(Number(value))}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--color-popover-foreground)',
            }}
            labelStyle={{ color: 'var(--color-muted-foreground)', marginBottom: 4 }}
          />
          <Bar
            dataKey="amountMinor"
            name="Collected"
            fill="var(--color-chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
