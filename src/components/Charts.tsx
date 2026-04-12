'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
  LineChart, Line, CartesianGrid,
} from 'recharts';

import { abbreviateNumber } from '@/lib/utils';

const TIER_COLORS: Record<string, string> = {
  'War Legend': '#f59e0b',
  'Elite Warrior': '#8b5cf6',
  'Frontline Fighter': '#3b82f6',
  'Support Role': '#10b981',
  'Inactive': '#64748b',
};

// Custom tooltip
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <p className="label">{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any, i: number) => (
        <p key={i} className="value" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? abbreviateNumber(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// Kill delta bar chart
export function KillsBarChart({ data }: { data: { name: string; killDelta: number }[] }) {
  const sorted = [...data].sort((a, b) => b.killDelta - a.killDelta).slice(0, 15);
  return (
    <div className="chart-container">
      <h3>📊 Kill Points Delta — Top 15</h3>
      <div style={{ width: '100%', height: 350 }}>
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ left: 80, right: 20 }}>
            <XAxis type="number" tickFormatter={(v) => abbreviateNumber(v)} stroke="#475569" />
            <YAxis type="category" dataKey="name" stroke="#94a3b8" width={75} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="killDelta" radius={[0, 4, 4, 0]}>
              {sorted.map((_, i) => (
                <Cell key={i} fill={i < 3 ? '#f59e0b' : i < 7 ? '#8b5cf6' : '#3b82f6'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Tier distribution pie chart
export function TierPieChart({ distribution }: { distribution: Record<string, number> }) {
  const data = Object.entries(distribution)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  if (data.length === 0) return null;

  return (
    <div className="chart-container">
      <h3>🎯 Warrior Tier Distribution</h3>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={TIER_COLORS[entry.name] || '#64748b'} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Growth line chart for governor timeline
export function GrowthLineChart({
  timeline,
}: {
  timeline: { eventName: string; power: number; killPoints: number; deads: number }[];
}) {
  return (
    <div className="chart-container">
      <h3>📈 Growth Timeline</h3>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={timeline}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="eventName" stroke="#94a3b8" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => abbreviateNumber(v)} stroke="#475569" />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Power" />
            <Line type="monotone" dataKey="killPoints" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="Kill Points" />
            <Line type="monotone" dataKey="deads" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} name="Deads" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
