'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  Database,
  Download,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DataTableLite,
  type DataTableLiteColumn,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';
import { formatCompactNumber, formatMetric, toSafeBigInt, csvValue, downloadCsv } from '@/features/shared/formatters';
import { cn } from '@/lib/utils';
import { useWorkspaceSession } from '@/lib/workspace-session';

/* ──────────────────────── Types ──────────────────────── */

const ALL_VALUE = '__all__';

type SortKey = 'name' | 'power' | 'killPoints' | 'contribution' | 'forts' | 'kpGrowth' | 'powerGrowth';
type SortDir = 'asc' | 'desc';

interface GovernorRow {
  id: string;
  governorId: string;
  name: string;
  alliance: string;
  snapshotCount: number;
  latestPower: string;
  latestKillPoints: string;
  weeklyStats: Record<string, string>;
  previousWeekStats: Record<string, string>;
}

interface RegisterForm {
  name: string;
  governorId: string;
  alliance: string;
}

interface EditingCell {
  rowId: string;
  field: 'name' | 'alliance';
  value: string;
}

/* ────────────────────── Helpers ──────────────────────── */

function parseMetric(value: string | undefined | null): bigint {
  return toSafeBigInt(value || '0');
}

function computeGrowth(current: string | undefined, previous: string | undefined): bigint | null {
  if (!current || !previous) return null;
  const c = parseMetric(current);
  const p = parseMetric(previous);
  if (p === BigInt(0)) return null;
  return c - p;
}

function growthDisplay(growth: bigint | null): string {
  if (growth === null) return '—';
  if (growth === BigInt(0)) return '0';
  const prefix = growth > BigInt(0) ? '+' : '';
  return `${prefix}${formatCompactNumber(growth.toString())}`;
}

function growthTone(growth: bigint | null): 'good' | 'bad' | 'neutral' {
  if (growth === null || growth === BigInt(0)) return 'neutral';
  return growth > BigInt(0) ? 'good' : 'bad';
}

function allianceTone(alliance: string): 'warn' | 'info' | 'neutral' {
  if (alliance.includes('GODt')) return 'warn';
  if (alliance.includes('V57')) return 'info';
  return 'neutral';
}

function bigintCmp(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function compareRows(a: GovernorRow, b: GovernorRow, key: SortKey, dir: SortDir): number {
  let diff = 0;
  switch (key) {
    case 'name':
      diff = a.name.localeCompare(b.name);
      break;
    case 'power':
      diff = bigintCmp(parseMetric(a.latestPower), parseMetric(b.latestPower));
      break;
    case 'killPoints':
      diff = bigintCmp(parseMetric(a.latestKillPoints), parseMetric(b.latestKillPoints));
      break;
    case 'contribution':
      diff = bigintCmp(
        parseMetric(a.weeklyStats?.contribution_points),
        parseMetric(b.weeklyStats?.contribution_points)
      );
      break;
    case 'forts':
      diff = bigintCmp(
        parseMetric(a.weeklyStats?.fort_destroying),
        parseMetric(b.weeklyStats?.fort_destroying)
      );
      break;
    case 'kpGrowth': {
      const ga = computeGrowth(a.weeklyStats?.kill_points, a.previousWeekStats?.kill_points) ?? BigInt(0);
      const gb = computeGrowth(b.weeklyStats?.kill_points, b.previousWeekStats?.kill_points) ?? BigInt(0);
      diff = bigintCmp(ga, gb);
      break;
    }
    case 'powerGrowth': {
      const pa = computeGrowth(a.weeklyStats?.power, a.previousWeekStats?.power) ?? BigInt(0);
      const pb = computeGrowth(b.weeklyStats?.power, b.previousWeekStats?.power) ?? BigInt(0);
      diff = bigintCmp(pa, pb);
      break;
    }
  }
  return dir === 'asc' ? diff : -diff;
}

/* ─────────────────── Register Dialog ─────────────────── */

function RegisterPlayerDialog({
  open,
  onClose,
  onRegister,
  busy,
  feedbackMessage,
}: {
  open: boolean;
  onClose: () => void;
  onRegister: (form: RegisterForm) => void;
  busy: boolean;
  feedbackMessage: { type: 'success' | 'error'; text: string } | null;
}) {
  const [form, setForm] = useState<RegisterForm>({ name: '', governorId: '', alliance: '' });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 w-full max-w-md overflow-hidden rounded-[24px] border border-[color:var(--stroke-soft)] bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--stroke-subtle)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2">
              <Plus className="size-4 text-cyan-300" />
            </div>
            <div>
              <h2 className="font-heading text-lg font-semibold text-tier-1">Register Player</h2>
              <p className="text-xs text-tier-3">Add a new player to the database</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-tier-3 hover:bg-white/5 hover:text-tier-1">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-tier-3" htmlFor="reg-name">Player Name *</label>
            <Input
              id="reg-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. GdHama"
              className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-tier-3" htmlFor="reg-govid">Governor ID *</label>
            <Input
              id="reg-govid"
              value={form.governorId}
              onChange={(e) => setForm({ ...form, governorId: e.target.value })}
              placeholder="e.g. 222067061"
              className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-tier-3" htmlFor="reg-alliance">Alliance</label>
            <Input
              id="reg-alliance"
              value={form.alliance}
              onChange={(e) => setForm({ ...form, alliance: e.target.value })}
              placeholder="e.g. [GODt] GOD of Thunder"
              className="border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
            />
          </div>

          {feedbackMessage ? (
            <div
              className={cn(
                'rounded-xl border px-3 py-2 text-xs',
                feedbackMessage.type === 'success'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                  : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
              )}
            >
              {feedbackMessage.text}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--stroke-subtle)] px-5 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onRegister(form)}
            disabled={busy || !form.name.trim() || !form.governorId.trim()}
            className="rounded-full bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 border border-cyan-400/30 disabled:opacity-40"
          >
            {busy ? 'Registering…' : 'Register'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Main Screen ─────────────────────── */

export default function PlayersScreen() {
  const {
    workspaceId,
    accessToken,
    ready,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();

  const [rows, setRows] = useState<GovernorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [allianceFilter, setAllianceFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('power');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search]);

  /* ─── Fetch list ─── */
  const loadGovernors = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        workspaceId,
        limit: '200',
        includeWeekly: 'true',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`/api/v2/governors?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load players.');
      }

      const data = Array.isArray(payload?.data) ? (payload.data as GovernorRow[]) : [];
      setRows(data);
      setTotal(payload?.meta?.total ?? data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load players.');
    } finally {
      setLoading(false);
    }
  }, [ready, workspaceId, accessToken, debouncedSearch]);

  useEffect(() => {
    void loadGovernors();
  }, [loadGovernors]);

  /* ─── Alliance list from data ─── */
  const alliances = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.alliance) set.add(row.alliance);
    }
    return [...set].sort();
  }, [rows]);

  /* ─── Filter + Sort ─── */
  const filteredRows = useMemo(() => {
    let filtered = rows;
    if (allianceFilter && allianceFilter !== ALL_VALUE) {
      filtered = filtered.filter((r) => r.alliance === allianceFilter);
    }
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [rows, allianceFilter, sortKey, sortDir]);

  /* ─── KPI calculations ─── */
  const kpis = useMemo(() => {
    const totalPlayers = filteredRows.length;
    const avgPower =
      totalPlayers > 0
        ? filteredRows.reduce((sum, r) => sum + Number(parseMetric(r.latestPower)), 0) / totalPlayers
        : 0;
    const totalContribution = filteredRows.reduce(
      (sum, r) => sum + Number(parseMetric(r.weeklyStats?.contribution_points)),
      0
    );
    const totalForts = filteredRows.reduce(
      (sum, r) => sum + Number(parseMetric(r.weeklyStats?.fort_destroying)),
      0
    );
    return { totalPlayers, avgPower, totalContribution, totalForts };
  }, [filteredRows]);

  /* ─── Register handler ─── */
  const handleRegister = useCallback(
    async (form: RegisterForm) => {
      if (!ready) return;
      setRegisterBusy(true);
      setRegisterMessage(null);

      try {
        const res = await fetch('/api/v2/governors/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            name: form.name.trim(),
            governorId: form.governorId.trim(),
            alliance: form.alliance.trim(),
          }),
        });
        const payload = await res.json();

        if (!res.ok) {
          throw new Error(payload?.error?.message || 'Registration failed.');
        }

        setRegisterMessage({
          type: 'success',
          text: payload?.data?.registered ? `${form.name} registered successfully!` : `${form.name} already existed; updated.`,
        });

        // Reload list
        void loadGovernors();
      } catch (err) {
        setRegisterMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Registration failed.',
        });
      } finally {
        setRegisterBusy(false);
      }
    },
    [ready, accessToken, workspaceId, loadGovernors]
  );

  /* ─── Inline edit handler ─── */
  const handleSaveEdit = useCallback(
    async (rowId: string, field: 'name' | 'alliance', value: string) => {
      if (!ready) return;
      setEditBusy(true);

      try {
        const res = await fetch(`/api/v2/governors/${rowId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            [field]: value.trim(),
          }),
        });

        if (!res.ok) {
          const payload = await res.json();
          throw new Error(payload?.error?.message || 'Update failed.');
        }

        // Optimistic update
        setRows((prev) =>
          prev.map((row) =>
            row.id === rowId ? { ...row, [field]: value.trim() } : row
          )
        );
        setEditingCell(null);
      } catch (err) {
        console.error('Edit failed:', err);
      } finally {
        setEditBusy(false);
      }
    },
    [ready, accessToken, workspaceId]
  );

  /* ─── Delete handler ─── */
  const handleDelete = useCallback(
    async (rowId: string, playerName: string) => {
      if (!ready) return;
      if (!window.confirm(`Remove ${playerName} from the database?`)) return;

      try {
        const res = await fetch(`/api/v2/governors/${rowId}?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: 'DELETE',
          headers: { 'x-access-token': accessToken },
        });

        if (!res.ok) {
          const payload = await res.json();
          throw new Error(payload?.error?.message || 'Delete failed.');
        }

        setRows((prev) => prev.filter((row) => row.id !== rowId));
      } catch (err) {
        console.error('Delete failed:', err);
      }
    },
    [ready, accessToken, workspaceId]
  );

  /* ─── CSV Export ─── */
  const handleExport = useCallback(() => {
    const headers = [
      'Name',
      'Governor ID',
      'Alliance',
      'Power',
      'Kill Points',
      'Contribution',
      'Forts Destroyed',
      'KP Growth',
      'Power Growth',
    ];

    const csvRows = filteredRows.map((r) => {
      const kpGrowth = computeGrowth(r.weeklyStats?.kill_points, r.previousWeekStats?.kill_points);
      const pwrGrowth = computeGrowth(r.weeklyStats?.power, r.previousWeekStats?.power);
      return [
        csvValue(r.name),
        csvValue(r.governorId),
        csvValue(r.alliance),
        csvValue(r.latestPower),
        csvValue(r.latestKillPoints),
        csvValue(r.weeklyStats?.contribution_points || '0'),
        csvValue(r.weeklyStats?.fort_destroying || '0'),
        csvValue(kpGrowth?.toString() || ''),
        csvValue(pwrGrowth?.toString() || ''),
      ].join(',');
    });

    downloadCsv(`players-export-${new Date().toISOString().slice(0, 10)}.csv`, [headers.join(','), ...csvRows]);
  }, [filteredRows]);

  /* ─── Sort toggle ─── */
  const handleSort = useCallback(
    (key: string) => {
      const typedKey = key as SortKey;
      if (sortKey === typedKey) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(typedKey);
        setSortDir('desc');
      }
    },
    [sortKey]
  );

  /* ─── Table columns ─── */
  const columns: DataTableLiteColumn<GovernorRow>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Player',
        sortable: true,
        className: 'min-w-[180px]',
        render: (row) => {
          if (editingCell?.rowId === row.id && editingCell.field === 'name') {
            return (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleSaveEdit(row.id, 'name', editingCell.value);
                    } else if (e.key === 'Escape') {
                      setEditingCell(null);
                    }
                  }}
                  className="h-8 w-36 border-cyan-400/30 bg-[color:var(--surface-4)] text-sm text-tier-1"
                  disabled={editBusy}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveEdit(row.id, 'name', editingCell.value)}
                  disabled={editBusy}
                  className="rounded-md p-1 text-emerald-400 hover:bg-emerald-400/10"
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCell(null)}
                  className="rounded-md p-1 text-tier-3 hover:bg-white/5"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          }

          const initial = row.name.charAt(0).toUpperCase() || '?';
          return (
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 border border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.1)] text-xs font-bold text-cyan-300">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-tier-1 drop-shadow-sm">{row.name}</p>
                <p className="text-[11px] text-tier-3 font-mono opacity-80 mt-0.5">ID: {row.governorId}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCell({ rowId: row.id, field: 'name', value: row.name })}
                className="shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-white/5 text-tier-3 ml-2"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          );
        },
      },
      {
        key: 'alliance',
        label: 'Alliance',
        sortable: false,
        className: 'min-w-[120px]',
        render: (row) => {
          if (editingCell?.rowId === row.id && editingCell.field === 'alliance') {
            return (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={editingCell.value}
                  onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleSaveEdit(row.id, 'alliance', editingCell.value);
                    } else if (e.key === 'Escape') {
                      setEditingCell(null);
                    }
                  }}
                  className="h-8 w-28 border-cyan-400/30 bg-[color:var(--surface-4)] text-sm text-tier-1"
                  disabled={editBusy}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveEdit(row.id, 'alliance', editingCell.value)}
                  disabled={editBusy}
                  className="rounded-md p-1 text-emerald-400 hover:bg-emerald-400/10"
                >
                  <Check className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCell(null)}
                  className="rounded-md p-1 text-tier-3 hover:bg-white/5"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div className="flex items-center gap-1.5">
              {row.alliance ? (
                <StatusPill label={row.alliance} tone={allianceTone(row.alliance)} />
              ) : (
                <span className="text-xs text-tier-4">—</span>
              )}
              <button
                type="button"
                onClick={() => setEditingCell({ rowId: row.id, field: 'alliance', value: row.alliance })}
                className="shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-white/5 text-tier-3"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          );
        },
      },
      {
        key: 'power',
        label: 'Power',
        sortable: true,
        className: 'text-right min-w-[110px]',
        thClassName: 'text-right',
        render: (row) => (
          <div className="inline-flex items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-sm font-bold text-cyan-100 shadow-[0_0_8px_rgba(6,182,212,0.1)]">
            {formatCompactNumber(row.latestPower)}
          </div>
        ),
      },
      {
        key: 'killPoints',
        label: 'Kill Points',
        sortable: true,
        className: 'text-right min-w-[110px]',
        thClassName: 'text-right',
        render: (row) => (
          <div className="inline-flex items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-sm font-bold text-rose-100 shadow-[0_0_8px_rgba(244,63,94,0.1)]">
            {formatCompactNumber(row.latestKillPoints)}
          </div>
        ),
      },
      {
        key: 'contribution',
        label: 'Tech Contrib.',
        sortable: true,
        className: 'text-right tabular-nums min-w-[100px]',
        thClassName: 'text-right',
        render: (row) => {
          const val = row.weeklyStats?.contribution_points;
          return (
            <span className={cn('text-sm', val && val !== '0' ? 'text-cyan-200 font-medium' : 'text-tier-3')}>
              {val ? formatMetric(val) : '—'}
            </span>
          );
        },
      },
      {
        key: 'forts',
        label: 'Forts',
        sortable: true,
        className: 'text-right tabular-nums min-w-[70px]',
        thClassName: 'text-right',
        render: (row) => {
          const val = row.weeklyStats?.fort_destroying;
          return (
            <span className={cn('text-sm', val && val !== '0' ? 'text-amber-200 font-medium' : 'text-tier-3')}>
              {val ? formatMetric(val) : '—'}
            </span>
          );
        },
      },
      {
        key: 'kpGrowth',
        label: 'KP Δ',
        sortable: true,
        className: 'text-right tabular-nums min-w-[90px]',
        thClassName: 'text-right',
        render: (row) => {
          const growth = computeGrowth(row.weeklyStats?.kill_points, row.previousWeekStats?.kill_points);
          const tone = growthTone(growth);
          return (
            <span
              className={cn(
                'text-sm font-medium',
                tone === 'good' && 'text-emerald-300 drop-shadow-sm',
                tone === 'bad' && 'text-rose-300',
                tone === 'neutral' && 'text-tier-3'
              )}
            >
              {growthDisplay(growth)}
            </span>
          );
        },
      },
      {
        key: 'powerGrowth',
        label: 'Power Δ',
        sortable: true,
        className: 'text-right tabular-nums min-w-[90px]',
        thClassName: 'text-right',
        render: (row) => {
          const growth = computeGrowth(row.weeklyStats?.power, row.previousWeekStats?.power);
          const tone = growthTone(growth);
          return (
            <span
              className={cn(
                'text-sm font-medium',
                tone === 'good' && 'text-emerald-300 drop-shadow-sm',
                tone === 'bad' && 'text-rose-300',
                tone === 'neutral' && 'text-tier-3'
              )}
            >
              {growthDisplay(growth)}
            </span>
          );
        },
      },
      {
        key: 'actions',
        label: '',
        className: 'w-[40px]',
        render: (row) => (
          <button
            type="button"
            onClick={() => void handleDelete(row.id, row.name)}
            className="rounded-lg p-1.5 text-tier-4 transition-colors hover:bg-rose-400/10 hover:text-rose-300"
            title="Remove player"
          >
            <Trash2 className="size-3.5" />
          </button>
        ),
      },
    ],
    [editingCell, editBusy, handleSaveEdit, handleDelete]
  );

  /* ─── Render ─── */
  return (
    <SessionGate
      ready={ready}
      loading={sessionLoading}
      error={sessionError}
      loadingLabel="Loading workspace…"
      notReadyLabel="Sign in to view the player database."
      onRetry={refreshSession}
    >
      <div className="grid gap-5 min-[390px]:gap-6 sm:gap-7">
        {/* Hero */}
        <PageHero
          title="Player Database"
          subtitle="Manage all registered players, view weekly stats, and track performance. Register players via profile screenshots and update stats via weekly leaderboards."
          badges={[`${total} players`]}
          density="balanced-compact"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setRegisterOpen(true);
                  setRegisterMessage(null);
                }}
                className="rounded-full bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 border border-cyan-400/30"
              >
                <Plus className="mr-1 size-4" /> Register Player
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-2 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                disabled={filteredRows.length === 0}
              >
                <Download className="mr-1 size-4" /> Export CSV
              </Button>
            </div>
          }
        />

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 min-[390px]:gap-4">
          <KpiCard label="Total Players" value={kpis.totalPlayers} icon={<Users />} tone="info" density="compact" />
          <KpiCard
            label="Avg Power"
            value={formatCompactNumber(Math.round(kpis.avgPower))}
            icon={<Shield />}
            tone="neutral"
            density="compact"
          />
          <KpiCard
            label="Week Contribution"
            value={formatCompactNumber(kpis.totalContribution)}
            icon={<Database />}
            tone="good"
            density="compact"
          />
          <KpiCard
            label="Week Forts"
            value={formatCompactNumber(kpis.totalForts)}
            icon={<ArrowDownUp />}
            tone="warn"
            density="compact"
          />
        </div>

        {/* Filters */}
        <FilterBar density="balanced-compact">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tier-3" />
            <Input
              id="player-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or ID…"
              className="min-h-11 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] pl-9 text-tier-1 placeholder:text-tier-4"
            />
          </div>
          <Select
            value={allianceFilter || ALL_VALUE}
            onValueChange={(val) => setAllianceFilter(val === ALL_VALUE ? '' : val)}
          >
            <SelectTrigger
              id="alliance-filter"
              className="min-h-11 w-44 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-2"
            >
              <SelectValue placeholder="All Alliances" />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--stroke-soft)] bg-card text-tier-1">
              <SelectItem value={ALL_VALUE}>All Alliances</SelectItem>
              {alliances.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>

        {/* Error */}
        {error ? <InlineError message={error} /> : null}

        {/* Table */}
        {loading ? (
          <SkeletonSet rows={8} />
        ) : filteredRows.length === 0 && !debouncedSearch ? (
          <EmptyState
            title="No players registered"
            description="Register players manually or upload profile screenshots to populate the database."
            action={
              <Button
                onClick={() => {
                  setRegisterOpen(true);
                  setRegisterMessage(null);
                }}
                className="rounded-full bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 border border-cyan-400/30"
              >
                <Plus className="mr-1 size-4" /> Register First Player
              </Button>
            }
          />
        ) : (
          <DataTableLite
            columns={columns}
            rows={filteredRows}
            rowKey={(row) => row.id}
            rowClassName={() => 'group/row'}
            onSort={handleSort}
            sortKey={sortKey}
            sortDir={sortDir}
            stickyFirst
            dense
            emptyLabel={debouncedSearch ? `No players matching "${debouncedSearch}"` : 'No players found.'}
            density="compact"
          />
        )}
      </div>

      {/* Registration Modal */}
      <RegisterPlayerDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegister={handleRegister}
        busy={registerBusy}
        feedbackMessage={registerMessage}
      />
    </SessionGate>
  );
}
