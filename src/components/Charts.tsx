'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { abbreviateNumber } from '@/lib/utils';

const TIER_COLORS: Record<string, string> = {
  'War Legend': '#3b82f6',
  'Elite Warrior': '#60a5fa',
  'Frontline Fighter': '#93c5fd',
  'Support Role': '#e2e8f0',
  Inactive: '#64748b',
};

function prettyNumber(value: string | number) {
  if (typeof value === 'number') return abbreviateNumber(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? abbreviateNumber(parsed) : value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip" role="status" aria-live="polite">
      <p className="label">{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((entry: any, index: number) => (
        <p key={`${entry.name || 'value'}-${index}`} className="value" style={{ color: entry.color }}>
          {entry.name}: {prettyNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function KillsBarChart({ data }: { data: { name: string; killDelta: number }[] }) {
  const sorted = [...data]
    .sort((a, b) => b.killDelta - a.killDelta)
    .slice(0, 15)
    .map((entry, index) => ({
      ...entry,
      tone: index < 3 ? '#3b82f6' : index < 7 ? '#60a5fa' : '#93c5fd',
    }));

  return (
    <section className="chart-container" aria-label="Kill points delta chart">
      <h3>Kill Points Delta Top 15</h3>
      <div style={{ width: '100%', minWidth: 0, height: 340 }}>
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ left: 70, right: 20, top: 8, bottom: 8 }}>
            <CartesianGrid stroke="rgba(113, 138, 165, 0.16)" strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => abbreviateNumber(v)} stroke="#8da5c2" />
            <YAxis type="category" dataKey="name" stroke="#8da5c2" width={66} tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="killDelta" name="Kill Delta" radius={[0, 5, 5, 0]}>
              {sorted.map((entry, idx) => (
                <Cell key={`${entry.name}-${idx}`} fill={entry.tone} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function TierPieChart({ distribution }: { distribution: Record<string, number> }) {
  const data = Object.entries(distribution)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));

  if (data.length === 0) {
    return null;
  }

  return (
    <section className="chart-container" aria-label="Tier distribution chart">
      <h3>Warrior Tier Distribution</h3>
      <div style={{ width: '100%', minWidth: 0, height: 300 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={94}
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
            >
              {data.map((entry, idx) => (
                <Cell key={`${entry.name}-${idx}`} fill={TIER_COLORS[entry.name] || '#718aa5'} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: '12px', color: '#9ab0cb' }} />
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function GrowthLineChart({
  timeline,
}: {
  timeline: { eventName: string; power: number; killPoints: number; deads: number }[];
}) {
  const avgPower =
    timeline.length > 0
      ? timeline.reduce((sum, row) => sum + row.power, 0) / timeline.length
      : 0;

  return (
    <section className="chart-container" aria-label="Growth timeline chart">
      <h3>Growth Timeline</h3>
      <div style={{ width: '100%', minWidth: 0, height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={timeline}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(113, 138, 165, 0.16)" />
            <XAxis dataKey="eventName" stroke="#8da5c2" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => abbreviateNumber(v)} stroke="#8da5c2" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#9ab0cb' }} />
            {avgPower > 0 ? (
              <ReferenceLine
                y={Math.round(avgPower)}
                stroke="#60a5fa"
                strokeDasharray="5 5"
                label={{ value: 'Avg Power', fill: '#60a5fa', fontSize: 11 }}
              />
            ) : null}
            <Line type="monotone" dataKey="power" stroke="#3b82f6" strokeWidth={2.2} dot={{ r: 3 }} name="Power" />
            <Line
              type="monotone"
              dataKey="killPoints"
              stroke="#93c5fd"
              strokeWidth={2.2}
              dot={{ r: 3 }}
              name="Kill Points"
            />
            <Line type="monotone" dataKey="deads" stroke="#f43f5e" strokeWidth={2.2} dot={{ r: 3 }} name="Deads" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function WeeklyActivityLineChart({
  timeline,
}: {
  timeline: Array<{
    weekName: string;
    contributionPoints: number;
    fortDestroying: number;
    powerGrowth: number;
    killPointsGrowth: number;
  }>;
}) {
  return (
    <section className="chart-container" aria-label="Weekly activity timeline chart">
      <h3>Weekly Activity Trends</h3>
      <div style={{ width: '100%', minWidth: 0, height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={timeline}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(113, 138, 165, 0.16)" />
            <XAxis dataKey="weekName" stroke="#8da5c2" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => abbreviateNumber(v)} stroke="#8da5c2" />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#9ab0cb' }} />
            <Line
              type="monotone"
              dataKey="contributionPoints"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              name="Contribution"
            />
            <Line
              type="monotone"
              dataKey="fortDestroying"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              name="Fort"
            />
            <Line
              type="monotone"
              dataKey="powerGrowth"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              name="Power Growth"
            />
            <Line
              type="monotone"
              dataKey="killPointsGrowth"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              name="KP Growth"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
