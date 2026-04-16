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
  const candidatePreview = parseCandidatePreview(row.candidates);
  const boardLabel = getRankingTypeDisplayName(row.run.rankingType);
  const metricLabel = getMetricDisplayName(row.run.metricKey);
  const supportedBoard = getSupportedBoardForPair(row.run.rankingType, row.run.metricKey);
  const rerunMismatch =
    rerunHint &&
    (rerunHint.detectedRankingType !== row.run.rankingType ||
      rerunHint.detectedMetricKey !== row.run.metricKey);

  const busy = busyRow != null;

  const correctionFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/4 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Governor Game ID</p>
        <Input
          value={draft.governorGameId}
          onChange={(event) => onUpdateDraft('governorGameId', event.target.value)}
          placeholder="e.g. 222067061"
          className="rounded-xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/4 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Alias For Create Alias</p>
        <Input
          value={draft.aliasRaw}
          onChange={(event) => onUpdateDraft('aliasRaw', event.target.value)}
          className="rounded-xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/4 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Corrected Rank</p>
        <Input
          value={draft.sourceRank}
          onChange={(event) => onUpdateDraft('sourceRank', event.target.value)}
          className="rounded-xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/4 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Corrected Name</p>
        <Input
          value={draft.governorNameRaw}
          onChange={(event) => onUpdateDraft('governorNameRaw', event.target.value)}
          className="rounded-xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
        />
      </div>
      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/4 p-3 sm:col-span-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">Corrected Metric</p>
        <Input
          value={draft.metricRaw}
          onChange={(event) => onUpdateDraft('metricRaw', event.target.value)}
          className="rounded-xl border-white/10 bg-black/20 text-white placeholder:text-white/28"
        />
      </div>
    </div>
  );

  return (
    <article className="rounded-[26px] border border-white/12 bg-[rgba(10,14,24,0.92)] p-4 shadow-[0_16px_32px_rgba(0,0,0,0.24)] max-[390px]:rounded-[22px] max-[390px]:p-3.5 sm:p-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-lg text-white sm:text-xl">{row.governorNameRaw || 'Unknown'}</h3>
            <p className="mt-1 text-xs text-white/48">
              Row #{row.id.slice(-8)} • {formatWhen(row.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusPill label={row.identityStatus} tone={identityTone(row.identityStatus)} />
            <StatusPill label={boardLabel} tone={supportedBoard ? 'info' : 'bad'} />
            <StatusPill label={`${Math.round(row.confidence)}%`} tone={confidenceTone(row.confidence)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatusPill label={metricLabel} tone="neutral" />
          <StatusPill label={`Rank ${row.sourceRank ?? '—'}`} tone="neutral" />
          <StatusPill label={`Metric ${row.metricValue || '—'}`} tone="neutral" />
        </div>

        {row.run.headerText ? (
          <p className="text-sm text-white/58">Header: {row.run.headerText}</p>
        ) : null}
        {(row.allianceRaw || row.titleRaw) ? (
          <p className="text-sm text-white/58">
            {row.allianceRaw ? `Alliance ${row.allianceRaw}` : `Title ${row.titleRaw}`}
          </p>
        ) : null}
        {candidatePreview.length > 0 ? (
          <p className="text-sm text-white/58">Candidates: {candidatePreview.join(' • ')}</p>
        ) : null}
        {!supportedBoard ? (
          <div className="rounded-2xl border border-rose-300/16 bg-rose-400/10 px-3 py-2.5 text-xs text-rose-100">
            Unsupported ranking type/metric pair. Validate OCR header classification before approving.
          </div>
        ) : null}
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/4 p-3.5">
          {row.run.artifact?.url ? (
            <>
              <a
                href={row.run.artifact.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-black/20 px-3.5 text-sm text-white/82 hover:bg-black/30"
              >
                <ExternalLink className="size-4" />
                Open Screenshot
              </a>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <Image
                  src={row.run.artifact.url}
                  alt={`Ranking screenshot for ${row.governorNameRaw}`}
                  width={920}
                  height={520}
                  unoptimized
                  className="h-auto w-full"
                />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/12 bg-black/20 px-4 py-8 text-center text-sm text-white/52">
              Screenshot artifact is missing for this ranking row.
            </div>
          )}
        </section>

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

          <div className="rounded-2xl border border-white/10 bg-white/4 p-3.5">
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Select
                value={rerunProfileId || AUTO_PROFILE}
                onValueChange={(value) => onRerunProfileChange(value === AUTO_PROFILE ? '' : value)}
              >
                <SelectTrigger className="w-full rounded-xl border-white/10 bg-black/20 text-white">
                  <SelectValue placeholder="Auto-select rankboard profile" />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                  <SelectItem value={AUTO_PROFILE}>Auto-select rankboard profile</SelectItem>
                  {rankingProfiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} ({profile.profileKey} v{profile.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                className="rounded-full border-white/12 bg-black/20 text-white hover:bg-white/8 hover:text-white"
                onClick={onRerun}
                disabled={busy || !row.run.artifact?.url}
              >
                <RefreshCw data-icon="inline-start" />
                {busyRow === `${row.id}:RERUN_OCR` ? 'Re-running...' : 'Re-run OCR'}
              </Button>
            </div>

            <ActionFooter className="mt-3 border-white/8">
              <Button
                variant="outline"
                className="rounded-full border-white/12 bg-white/6 text-white hover:bg-white/10 hover:text-white"
                onClick={() => onAction('LINK_TO_GOVERNOR')}
                disabled={busy}
              >
                <Link2 data-icon="inline-start" />
                {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? 'Linking...' : 'Link Governor'}
              </Button>
              <Button
                variant="outline"
                className="rounded-full border-white/12 bg-white/6 text-white hover:bg-white/10 hover:text-white"
                onClick={() => onAction('CREATE_ALIAS')}
                disabled={busy}
              >
                <UserPlus data-icon="inline-start" />
                {busyRow === `${row.id}:CREATE_ALIAS` ? 'Saving...' : 'Create Alias'}
              </Button>
              <Button
                className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
                onClick={() => onAction('CORRECT_ROW')}
                disabled={busy}
              >
                <PencilLine data-icon="inline-start" />
                {busyRow === `${row.id}:CORRECT_ROW` ? 'Applying...' : 'Correct Row'}
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                onClick={() => onAction('REJECT_ROW')}
                disabled={busy}
              >
                <XCircle data-icon="inline-start" />
                {busyRow === `${row.id}:REJECT_ROW` ? 'Rejecting...' : 'Reject'}
              </Button>
            </ActionFooter>
          </div>

          {rerunHint ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3.5 text-sm text-white/65">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill
                  label={`Detected: ${getRankingTypeDisplayName(rerunHint.detectedRankingType)} / ${getMetricDisplayName(rerunHint.detectedMetricKey)}`}
                  tone={rerunMismatch ? 'bad' : 'good'}
                />
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
              {rerunHint.failureReasons.length > 0 ? (
                <p className="mt-2 text-white/58">
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
