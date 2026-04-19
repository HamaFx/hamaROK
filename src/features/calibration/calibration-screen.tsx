'use client';

import { useMemo, useState } from 'react';
import { FlaskConical, Upload, WandSparkles } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
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
import { KpiCard, PageHero, Panel } from '@/components/ui/primitives';

interface DiagnosticsResult {
  engineVersion?: string;
  screenArchetype?: string;
  lowConfidence?: boolean;
  failureReasons?: string[];
  normalized?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CalibrationScreen() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [file, setFile] = useState<File | null>(null);
  const [archetypeHint, setArchetypeHint] = useState<'unknown' | 'governor_profile' | 'ranking_board'>('unknown');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const lowConfidence = Boolean(result?.lowConfidence);
    const rowCount = Array.isArray(result?.rows) ? result?.rows.length : 0;
    const failureCount = Array.isArray(result?.failureReasons) ? result?.failureReasons.length : 0;
    return {
      lowConfidence,
      rowCount,
      failureCount,
    };
  }, [result]);

  const runDiagnostics = async () => {
    if (!workspaceReady || !workspaceId) {
      setError('Workspace session is not ready.');
      return;
    }
    if (!file) {
      setError('Select a screenshot before running diagnostics.');
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set('workspaceId', workspaceId);
      formData.set('archetypeHint', archetypeHint);
      formData.set('file', file);

      const response = await fetch('/api/v2/ocr/run', {
        method: 'POST',
        headers: {
          'x-access-token': accessToken,
        },
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Mistral diagnostics request failed.');
      }

      setResult(payload?.data || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mistral diagnostics failed.');
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Calibration"
        subtitle="Server-side Mistral extraction diagnostics for profile and ranking screenshots."
        badges={['Mistral OCR', 'Server Diagnostics', 'No Client OCR']}
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {error ? <InlineError message={error} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard
            label="Engine"
            value={result?.engineVersion || 'mistral'}
            hint="Current diagnostics engine"
            tone="info"
            animated={false}
          />
          <KpiCard
            label="Archetype"
            value={result?.screenArchetype || 'unknown'}
            hint="Detected screenshot type"
            tone="neutral"
            animated={false}
          />
          <KpiCard
            label="Rows"
            value={summary.rowCount}
            hint="Ranking rows extracted"
            tone="warn"
            animated={false}
          />
          <KpiCard
            label="Confidence"
            value={summary.lowConfidence ? 'Low' : 'OK'}
            hint={`Failure reasons: ${summary.failureCount}`}
            tone={summary.lowConfidence ? 'bad' : 'good'}
            animated={false}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Panel
            title="Diagnostics Input"
            subtitle="Upload one screenshot and choose an optional archetype hint."
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-tier-3">Screenshot</label>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const next = event.target.files?.[0] || null;
                    setFile(next);
                  }}
                />
                {file ? (
                  <p className="text-xs text-tier-3">
                    {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-tier-3">Archetype Hint</label>
                <Select
                  value={archetypeHint}
                  onValueChange={(value: 'unknown' | 'governor_profile' | 'ranking_board') =>
                    setArchetypeHint(value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select hint" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="governor_profile">Governor Profile</SelectItem>
                    <SelectItem value="ranking_board">Ranking Board</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90"
                onClick={runDiagnostics}
                disabled={running}
              >
                {running ? (
                  <WandSparkles data-icon="inline-start" />
                ) : (
                  <FlaskConical data-icon="inline-start" />
                )}
                {running ? 'Running Diagnostics...' : 'Run Mistral Diagnostics'}
              </Button>

              {!file ? (
                <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-2 text-xs text-tier-3">
                  <Upload className="mr-1 inline size-3.5" />
                  Attach a screenshot to test extraction output.
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Diagnostics Output"
            subtitle="Structured extraction output from server-side Mistral pipeline."
          >
            {!result ? (
              <p className="text-sm text-tier-3">Run diagnostics to inspect normalized extraction output.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-tier-3">Normalized/Profile Fields</p>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-3 text-xs text-tier-2">
                    {toPrettyJson(result.normalized || {})}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-tier-3">Ranking Rows</p>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-3 text-xs text-tier-2">
                    {toPrettyJson(result.rows || [])}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-tier-3">Metadata</p>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-3 text-xs text-tier-2">
                    {toPrettyJson({
                      lowConfidence: result.lowConfidence,
                      failureReasons: result.failureReasons || [],
                      metadata: result.metadata || {},
                    })}
                  </pre>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </SessionGate>
    </div>
  );
}
