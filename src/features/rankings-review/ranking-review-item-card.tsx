import Image from 'next/image';
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  PencilLine,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import {
  getMetricDisplayName,
  getRankingTypeDisplayName,
  getSupportedBoardForPair,
} from '@/lib/rankings/board-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ActionFooter, RowDetailDrawer, StatusPill } from '@/components/ui/primitives';
import {
  type RankingReviewDraft,
  type RerunHint,
  type ReviewAction,
  type ReviewRow,
  identityTone,
  parseCandidatePreview,
} from './ranking-review-model';

interface RankingReviewItemCardProps {
  row: ReviewRow;
  draft: RankingReviewDraft;
  rankingProfiles: OcrRuntimeProfile[];
  rerunProfileId: string;
  rerunHint: RerunHint | null;
  busyRow: string | null;
  onUpdateDraft: (field: keyof RankingReviewDraft, value: string) => void;
  onRerunProfileChange: (value: string) => void;
  onRerun: () => void;
  onAction: (action: ReviewAction) => void;
}

const AUTO_PROFILE = '__auto_rankboard__';

function formatWhen(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString();
}

function confidenceTone(confidence: number): 'good' | 'warn' | 'bad' {
  if (confidence >= 85) return 'good';
  if (confidence >= 70) return 'warn';
  return 'bad';
}

export function RankingReviewItemCard({
  row,
  draft,
  rankingProfiles,
  rerunProfileId,
  rerunHint,
  busyRow,
  onUpdateDraft,
  onRerunProfileChange,
  onRerun,
  onAction,
}: RankingReviewItemCardProps) {
  const candidatePreview =
    Array.isArray(row.identitySuggestions) && row.identitySuggestions.length > 0
      ? row.identitySuggestions.slice(0, 3).map((entry) => `${entry.name} (ID ${entry.governorGameId})`)
      : parseCandidatePreview(row.candidates);
  const boardLabel = getRankingTypeDisplayName(row.run.rankingType);
  const metricLabel = getMetricDisplayName(row.run.metricKey);
  const supportedBoard = getSupportedBoardForPair(row.run.rankingType, row.run.metricKey);
  const runDiagnostics = row.run.diagnostics || null;
  const runGuardFailures = runDiagnostics?.guardFailures || [];
  const runBoardTokens = runDiagnostics?.detectedBoardTokens || [];
  const rerunMismatch =
    rerunHint &&
    (rerunHint.detectedRankingType !== row.run.rankingType ||
      rerunHint.detectedMetricKey !== row.run.metricKey);

  const busy = busyRow != null;

  const correctionFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
        <p className="text-xs  text-tier-3">Governor Game ID</p>
        <Input
          value={draft.governorGameId}
          onChange={(event) => onUpdateDraft('governorGameId', event.target.value)}
          placeholder="e.g. 222067061"
          className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
        <p className="text-xs  text-tier-3">Alias For Create Alias</p>
        <Input
          value={draft.aliasRaw}
          onChange={(event) => onUpdateDraft('aliasRaw', event.target.value)}
          className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
        <p className="text-xs  text-tier-3">Corrected Rank</p>
        <Input
          value={draft.sourceRank}
          onChange={(event) => onUpdateDraft('sourceRank', event.target.value)}
          className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
        <p className="text-xs  text-tier-3">Corrected Name</p>
        <Input
          value={draft.governorNameRaw}
          onChange={(event) => onUpdateDraft('governorNameRaw', event.target.value)}
          className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3 sm:col-span-2">
        <p className="text-xs  text-tier-3">Corrected Metric</p>
        <Input
          value={draft.metricRaw}
          onChange={(event) => onUpdateDraft('metricRaw', event.target.value)}
          className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
        />
      </div>
    </div>
  );

  return (
    <article className="rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
      {/* Header Profile Unification */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--stroke-subtle)] pb-3 min-[390px]:pb-3.5 sm:pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h3 className="clamp-title-mobile font-heading text-lg font-bold text-tier-1 sm:text-xl" title={row.governorNameRaw || 'Unknown'}>{row.governorNameRaw || 'Unknown'}</h3>
              <StatusPill label={`${Math.round(row.confidence)}% text match`} tone={confidenceTone(row.confidence)} />
            </div>
            
            <div className="flex flex-wrap gap-2 text-sm text-tier-2 font-medium">
              <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">Rank {row.sourceRank ?? '—'}</span>
              <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">{row.metricValue || '—'} {metricLabel}</span>
              {row.allianceRaw && <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 text-cyan-200">[{row.allianceRaw}]</span>}
              {row.titleRaw && <span className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 text-rank-gold">({row.titleRaw})</span>}
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-tier-3">
              <span>Row #{row.id.slice(-8)}</span>
              <span>•</span>
              <span>{formatWhen(row.createdAt)}</span>
              <span>•</span>
              <span className={supportedBoard ? 'text-tier-3' : 'text-rose-400'}>{boardLabel}</span>
              {(runDiagnostics?.classificationConfidence != null || runDiagnostics?.droppedRowCount != null) && (
                <>
                  <span>•</span>
                  <span>Board ID: {Math.round(runDiagnostics?.classificationConfidence || 0)}%</span>
                  {runDiagnostics?.droppedRowCount ? ` • Dropped ${runDiagnostics.droppedRowCount}` : ''}
                </>
              )}
            </div>
            
            {candidatePreview.length > 0 && (
              <p className="mt-2.5 text-xs text-tier-3 bg-[color:var(--surface-3)] border border-[color:var(--stroke-soft)] p-2 rounded-xl">
                <strong className="text-tier-2 block mb-0.5"><Sparkles className="size-3 inline-block mr-1 -mt-0.5 text-cyan-300"/> Known Candidates Matched:</strong> {candidatePreview.join(' • ')}
              </p>
            )}
          </div>
          
          <div className="shrink-0 flex flex-col items-end gap-2">
            <StatusPill label={row.identityStatus.replace('_', ' ')} tone={identityTone(row.identityStatus)} />
          </div>
        </div>

        {/* Clean OCR Diagnostics Box */}
        {(!supportedBoard || runGuardFailures.length > 0 || runBoardTokens.length > 0) && (
          <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="size-4 text-rose-400"/> OCR Integrity Warnings
            </div>
            {!supportedBoard && <p className="text-xs opacity-90">• Unsupported ranking type/metric pair.</p>}
            {runGuardFailures.length > 0 && <p className="text-xs opacity-90">• Guard failures: {runGuardFailures.join(', ')}</p>}
            {runBoardTokens.length > 0 && <p className="text-xs opacity-70 mt-1">Detected Board Tokens: {runBoardTokens.join(' • ')}</p>}
          </div>
        )}
      </header>

      <div className="mt-4">
        <section className="space-y-3">
          <div className="hidden md:block">{correctionFields}</div>

          <div className="md:hidden">
            <RowDetailDrawer
              triggerLabel="Edit Row"
              title="Ranking Review Fields"
              description="Adjust identity/correction values before applying actions."
            >
              {correctionFields}
            </RowDetailDrawer>
          </div>

          <div className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5 sm:p-4 lg:p-5">
            <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[color:var(--stroke-subtle)]">
              <Select
                value={rerunProfileId || AUTO_PROFILE}
                onValueChange={(value) => onRerunProfileChange(value === AUTO_PROFILE ? '' : value)}
              >
                <SelectTrigger className="flex-1 rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 focus:ring-0">
                  <SelectValue placeholder="Auto-select profile" />
                </SelectTrigger>
                <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                  <SelectItem value={AUTO_PROFILE}>Auto-select profile</SelectItem>
                  {rankingProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} (v{profile.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                className="shrink-0 rounded-xl border-[color:var(--stroke-soft)] bg-black/40 text-tier-1 hover:bg-[color:var(--surface-4)]"
                onClick={onRerun}
                disabled={busy || !row.run.artifact?.url}
              >
                <RefreshCw className="mr-1.5 size-4" />
                {busyRow === `${row.id}:RERUN_OCR` ? 'Re-running...' : 'Re-run OCR'}
              </Button>
            </div>

            {/* Thumb-Friendly 2x2 Action Grid */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Button
                className="h-12 w-full rounded-2xl bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] text-[color:var(--primary)] hover:bg-[color:color-mix(in_oklab,var(--primary)_25%,transparent)] border border-[color:color-mix(in_oklab,var(--primary)_30%,transparent)] shadow-none text-xs sm:text-sm font-medium transition-all"
                onClick={() => onAction('LINK_TO_GOVERNOR')}
                disabled={busy}
              >
                <Link2 className="mr-1.5 size-4 opacity-80" />
                {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? 'Linking...' : 'Link Governor'}
              </Button>
              <Button
                className="h-12 w-full rounded-2xl bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/20 shadow-none text-xs sm:text-sm font-medium transition-all"
                onClick={() => onAction('CREATE_ALIAS')}
                disabled={busy}
              >
                <UserPlus className="mr-1.5 size-4 opacity-80" />
                {busyRow === `${row.id}:CREATE_ALIAS` ? 'Saving...' : 'Create Alias'}
              </Button>
              <Button
                className="h-12 w-full rounded-2xl bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 shadow-none text-xs sm:text-sm font-medium transition-all"
                onClick={() => onAction('CORRECT_ROW')}
                disabled={busy}
              >
                <PencilLine className="mr-1.5 size-4 opacity-80" />
                {busyRow === `${row.id}:CORRECT_ROW` ? 'Applying...' : 'Correct Row'}
              </Button>
              <Button
                variant="destructive"
                className="h-12 w-full rounded-2xl shadow-none text-xs sm:text-sm font-medium focus-visible:ring-0"
                onClick={() => onAction('REJECT_ROW')}
                disabled={busy}
              >
                <XCircle className="mr-1.5 size-4 opacity-80" />
                {busyRow === `${row.id}:REJECT_ROW` ? 'Rejecting...' : 'Reject Row'}
              </Button>
            </div>
          </div>

          {rerunHint ? (
            <div className="rounded-2xl border border-[color:var(--stroke-soft)] bg-black/20 p-3.5 text-sm text-tier-2">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill
                  label={`Detected: ${getRankingTypeDisplayName(rerunHint.detectedRankingType)} / ${getMetricDisplayName(rerunHint.detectedMetricKey)}`}
                  tone={rerunMismatch ? 'bad' : 'good'}
                />
                {rerunHint.classificationConfidence != null ? (
                  <StatusPill
                    label={`Classify ${Math.round(rerunHint.classificationConfidence)}%`}
                    tone={rerunHint.classificationConfidence >= 75 ? 'good' : 'warn'}
                  />
                ) : null}
                {rerunHint.droppedRowCount != null ? (
                  <StatusPill
                    label={`Dropped ${rerunHint.droppedRowCount}`}
                    tone={rerunHint.droppedRowCount > 0 ? 'warn' : 'info'}
                  />
                ) : null}
                {rerunHint.matchedSourceRank != null ? (
                  <StatusPill label={`Matched Rank ${rerunHint.matchedSourceRank}`} tone="info" />
                ) : null}
                {rerunHint.matchedConfidence != null ? (
                  <StatusPill
                    label={`Row Confidence ${Math.round(rerunHint.matchedConfidence)}%`}
                    tone={rerunHint.matchedConfidence < 70 ? 'warn' : 'good'}
                  />
                ) : null}
              </div>

              {rerunMismatch ? (
                <p className="mt-2 text-rose-100">
                  Re-run OCR detected a different board type/metric than this row. Confirm screenshot header before approving.
                </p>
              ) : null}
              {rerunHint.lowConfidence ? (
                <p className="mt-2 text-amber-100">
                  <AlertTriangle className="mr-1 inline size-4" />
                  Re-run OCR marked this result as low confidence.
                </p>
              ) : null}
              {Array.isArray(rerunHint.guardFailures) && rerunHint.guardFailures.length > 0 ? (
                <p className="mt-2 text-rose-100">
                  <ShieldAlert className="mr-1 inline size-4" />
                  Guard failures: {rerunHint.guardFailures.join(' • ')}
                </p>
              ) : null}
              {Array.isArray(rerunHint.detectedBoardTokens) && rerunHint.detectedBoardTokens.length > 0 ? (
                <p className="mt-2 text-tier-3">
                  Board tokens: {rerunHint.detectedBoardTokens.join(' • ')}
                </p>
              ) : null}
              {rerunHint.failureReasons.length > 0 ? (
                <p className="mt-2 text-tier-3">
                  <Sparkles className="mr-1 inline size-4" />
                  {rerunHint.failureReasons.join(' • ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {row.identityStatus === 'UNRESOLVED' ? (
            <p className="rounded-2xl border border-amber-300/16 bg-amber-300/10 px-3 py-2.5 text-sm text-amber-100">
              <ShieldAlert className="mr-1 inline size-4" />
              Ambiguous identity requires manual confirmation before canonical merge.
            </p>
          ) : null}
        </section>
      </div>
    </article>
  );
}
