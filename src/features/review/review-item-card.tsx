import Image from 'next/image';
import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
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
  type ExtractionStatus,
  type QueueItem,
  type ReviewDraft,
  REVIEW_FIELD_LABELS,
  REVIEW_FIELD_ORDER,
  formatFieldConfidence,
  reviewStatusTone,
} from './review-model';

interface ReviewItemCardProps {
  item: QueueItem;
  draft: ReviewDraft;
  actionBusy: string | null;
  profiles: OcrRuntimeProfile[];
  rerunProfileId: string;
  onRerunProfileChange: (value: string) => void;
  onUpdateDraft: (field: keyof ReviewDraft, value: string) => void;
  onRerun: () => void;
  onSaveGolden: () => void;
  onSubmit: (status: ExtractionStatus) => void;
}

const AUTO_PROFILE = '__auto__';

function statusTone(status: ExtractionStatus): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'APPROVED') return 'good';
  if (status === 'REJECTED') return 'bad';
  if (status === 'REVIEWED') return 'info';
  return 'warn';
}

function confidenceTone(confidence: number): 'good' | 'warn' | 'bad' {
  if (confidence >= 85) return 'good';
  if (confidence >= 70) return 'warn';
  return 'bad';
}

function formatWhen(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString();
}

export function ReviewItemCard({
  item,
  draft,
  actionBusy,
  profiles,
  rerunProfileId,
  onRerunProfileChange,
  onUpdateDraft,
  onRerun,
  onSaveGolden,
  onSubmit,
}: ReviewItemCardProps) {
  const busy = actionBusy != null;
  const busyApprove = actionBusy === `${item.id}APPROVED`;
  const busyReject = actionBusy === `${item.id}REJECTED`;
  const busyReviewed = actionBusy === `${item.id}REVIEWED`;
  const busyRerun = actionBusy === `${item.id}:rerun`;
  const busyFixture = actionBusy === `${item.id}:fixture`;

  const unresolvedValidation = item.validation.filter((entry) => entry.severity !== 'ok');

  const fieldEditors = (
    <div className="grid gap-3 sm:grid-cols-2">
      {REVIEW_FIELD_ORDER.map((field) => {
        const extracted = item.values[field];
        const candidatePreview = Array.isArray(extracted.candidates)
          ? extracted.candidates
              .slice(0, 2)
              .map((candidate) => String(candidate.normalizedValue || candidate.id || '').trim())
              .filter(Boolean)
          : [];

        return (
          <div key={field} className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium  text-tier-3">
                {REVIEW_FIELD_LABELS[field]}
              </p>
              <StatusPill label={formatFieldConfidence(extracted.confidence)} tone={confidenceTone(extracted.confidence)} />
            </div>
            <Input
              value={draft[field]}
              onChange={(event) => onUpdateDraft(field, event.target.value)}
              className="rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 placeholder:text-tier-3"
            />
            <div className="mt-2.5 space-y-1.5 text-xs text-tier-3">
              <p>
                OCR: <span className="text-tier-2">{extracted.value || '—'}</span>
              </p>
              {extracted.previousValue ? (
                <p>
                  Previous: <span className="text-tier-2">{extracted.previousValue}</span>
                </p>
              ) : null}
              {candidatePreview.length > 0 ? <p>Candidates: {candidatePreview.join(' • ')}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <article className="rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl" title={draft.governorName || item.values.governorName.value || 'Unknown Governor'}>
              {draft.governorName || item.values.governorName.value || 'Unknown Governor'}
            </h3>
            <p className="mt-1 text-xs text-tier-3">
              Queue #{item.id.slice(-8)} • {formatWhen(item.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <StatusPill label={item.status} tone={statusTone(item.status)} />
            <StatusPill label={`${Math.round(item.confidence)}%`} tone={confidenceTone(item.confidence)} />
            <StatusPill label={item.severity.level} tone={reviewStatusTone(item.severity.level)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {item.lowConfidence ? <StatusPill label="Low Confidence" tone="bad" /> : null}
          {item.syncState ? (
            <StatusPill label={item.syncState === 'SYNCED' ? 'Synced' : 'Pending Week Link'} tone={item.syncState === 'SYNCED' ? 'good' : 'warn'} />
          ) : null}
          {item.profile?.name ? <StatusPill label={`${item.profile.name} v${item.profile.version}`} tone="info" /> : null}
        </div>

        {item.failureReasons?.length ? (
          <div className="rounded-2xl border border-rose-300/16 bg-rose-400/10 px-3 py-2.5 text-xs text-rose-100">
            {item.failureReasons.slice(0, 4).join(' • ')}
          </div>
        ) : null}

        {unresolvedValidation.length ? (
          <div className="rounded-2xl border border-amber-300/16 bg-amber-300/10 px-3 py-2.5 text-xs text-amber-100">
            {unresolvedValidation
              .slice(0, 4)
              .map((entry) => `${entry.field}: ${entry.warning || entry.severity}`)
              .join(' • ')}
          </div>
        ) : null}
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <section className="space-y-3 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5">
          {item.artifact?.url ? (
            <>
              <a
                href={item.artifact.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[color:var(--stroke-soft)] bg-black/20 px-3.5 text-sm text-tier-2 hover:bg-black/30"
              >
                <ExternalLink className="size-4" />
                Open Screenshot
              </a>
              <div className="overflow-hidden rounded-2xl border border-[color:var(--stroke-soft)] bg-black/20">
                <Image
                  src={item.artifact.url}
                  alt={`OCR screenshot for ${draft.governorName || item.values.governorName.value || 'governor'}`}
                  width={880}
                  height={560}
                  unoptimized
                  className="h-auto w-full"
                />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--stroke-soft)] bg-black/20 px-4 py-8 text-center text-sm text-tier-3">
              Screenshot artifact is missing for this queue row.
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="hidden md:block">{fieldEditors}</div>

          <div className="md:hidden">
            <RowDetailDrawer
              triggerLabel="Edit Fields"
              title="Review Fields"
              description="Adjust extracted values before marking reviewed, approving, or rejecting."
            >
              {fieldEditors}
            </RowDetailDrawer>
          </div>

          <div className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5">
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Select
                value={rerunProfileId || AUTO_PROFILE}
                onValueChange={(value) => onRerunProfileChange(value === AUTO_PROFILE ? '' : value)}
              >
                <SelectTrigger className="w-full rounded-xl border-[color:var(--stroke-soft)] bg-black/20 text-tier-1">
                  <SelectValue placeholder="Auto-select OCR profile" />
                </SelectTrigger>
                <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                  <SelectItem value={AUTO_PROFILE}>Auto-select OCR profile</SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} ({profile.profileKey} v{profile.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={onRerun}
                disabled={busy || !item.artifact?.url}
              >
                <RefreshCw data-icon="inline-start" />
                {busyRerun ? 'Re-running...' : 'Re-run OCR'}
              </Button>

              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-black/20 text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={onSaveGolden}
                disabled={busy || !item.artifact?.id}
              >
                <Sparkles data-icon="inline-start" />
                {busyFixture ? 'Saving...' : 'Save Fixture'}
              </Button>
            </div>

            <ActionFooter className="mt-3 border-[color:var(--stroke-subtle)]">
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={() => onSubmit('REVIEWED')}
                disabled={busy}
              >
                <FlaskConical data-icon="inline-start" />
                {busyReviewed ? 'Marking...' : 'Mark Reviewed'}
              </Button>
              <Button
                className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
                onClick={() => onSubmit('APPROVED')}
                disabled={busy}
              >
                <CheckCircle2 data-icon="inline-start" />
                {busyApprove ? 'Approving...' : 'Approve'}
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                onClick={() => onSubmit('REJECTED')}
                disabled={busy}
              >
                <XCircle data-icon="inline-start" />
                {busyReject ? 'Rejecting...' : 'Reject'}
              </Button>
            </ActionFooter>
          </div>
        </section>
      </div>
    </article>
  );
}
