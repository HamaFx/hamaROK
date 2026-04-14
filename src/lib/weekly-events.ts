import { EventType, Prisma } from '@prisma/client';

interface EventStoreClient {
  event: {
    findFirst: Prisma.TransactionClient['event']['findFirst'];
    create: Prisma.TransactionClient['event']['create'];
  };
  workspaceSettings?: {
    findUnique: Prisma.TransactionClient['workspaceSettings']['findUnique'];
  };
}

type DbClient = Prisma.TransactionClient | EventStoreClient;

async function getDbClient(tx?: DbClient): Promise<DbClient> {
  if (tx) return tx;
  const { prisma } = await import('@/lib/prisma');
  return prisma;
}

export const DEFAULT_WEEK_RESET_UTC_OFFSET = '+00:00';
const WEEK_RESET_OFFSET_PATTERN = /^[+-](?:0\d|1[0-4]):[0-5]\d$/;

export interface WeekIdentity {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  startsAt: Date;
  endsAt: Date;
  weekResetUtcOffset: string;
}

function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfIsoWeekUtc(date: Date): Date {
  const d = toUtcDate(date);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoWeekYearAndNumber(date: Date): { isoYear: number; isoWeek: number } {
  const d = toUtcDate(date);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday
  const isoYear = d.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDay + 3);

  const weekDiff = d.getTime() - firstThursday.getTime();
  const isoWeek = 1 + Math.floor(weekDiff / (7 * 24 * 60 * 60 * 1000));
  return { isoYear, isoWeek };
}

function shiftDateByMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function formatWeekResetOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function normalizeWeekResetUtcOffset(value: string | null | undefined): string | null {
  const input = String(value || '').trim();
  if (!WEEK_RESET_OFFSET_PATTERN.test(input)) return null;

  const sign = input.startsWith('-') ? -1 : 1;
  const hours = Number(input.slice(1, 3));
  const mins = Number(input.slice(4, 6));
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;

  const totalMinutes = sign * (hours * 60 + mins);
  if (Math.abs(totalMinutes) > 14 * 60) return null;

  return formatWeekResetOffset(totalMinutes);
}

export function weekResetUtcOffsetToMinutes(value: string | null | undefined): number {
  const normalized =
    normalizeWeekResetUtcOffset(value) || DEFAULT_WEEK_RESET_UTC_OFFSET;
  const sign = normalized.startsWith('-') ? -1 : 1;
  const hours = Number(normalized.slice(1, 3));
  const mins = Number(normalized.slice(4, 6));
  return sign * (hours * 60 + mins);
}

export function parseWeekKey(weekKey: string): { isoYear: number; isoWeek: number } | null {
  const match = String(weekKey || '')
    .trim()
    .match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return null;
  }
  return { isoYear, isoWeek };
}

export function getWeekIdentity(
  date = new Date(),
  weekResetUtcOffset = DEFAULT_WEEK_RESET_UTC_OFFSET
): WeekIdentity {
  const normalizedOffset =
    normalizeWeekResetUtcOffset(weekResetUtcOffset) || DEFAULT_WEEK_RESET_UTC_OFFSET;
  const offsetMinutes = weekResetUtcOffsetToMinutes(normalizedOffset);
  const shiftedNow = shiftDateByMinutes(date, offsetMinutes);
  const { isoYear, isoWeek } = isoWeekYearAndNumber(shiftedNow);
  const localWeekStart = startOfIsoWeekUtc(shiftedNow);
  const localWeekEnd = new Date(localWeekStart);
  localWeekEnd.setUTCDate(localWeekEnd.getUTCDate() + 7);

  const startsAt = shiftDateByMinutes(localWeekStart, -offsetMinutes);
  const endsAt = shiftDateByMinutes(localWeekEnd, -offsetMinutes);
  const weekKey = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

  return {
    weekKey,
    isoYear,
    isoWeek,
    startsAt,
    endsAt,
    weekResetUtcOffset: normalizedOffset,
  };
}

export function getWeekIdentityFromKey(
  weekKey: string,
  weekResetUtcOffset = DEFAULT_WEEK_RESET_UTC_OFFSET
): WeekIdentity | null {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return null;

  const normalizedOffset =
    normalizeWeekResetUtcOffset(weekResetUtcOffset) || DEFAULT_WEEK_RESET_UTC_OFFSET;
  const offsetMinutes = weekResetUtcOffsetToMinutes(normalizedOffset);

  const jan4 = new Date(Date.UTC(parsed.isoYear, 0, 4));
  const week1Start = startOfIsoWeekUtc(jan4);
  const localWeekStart = new Date(week1Start);
  localWeekStart.setUTCDate(localWeekStart.getUTCDate() + (parsed.isoWeek - 1) * 7);
  const localWeekEnd = new Date(localWeekStart);
  localWeekEnd.setUTCDate(localWeekEnd.getUTCDate() + 7);

  const startsAt = shiftDateByMinutes(localWeekStart, -offsetMinutes);
  const endsAt = shiftDateByMinutes(localWeekEnd, -offsetMinutes);

  return {
    weekKey: `${parsed.isoYear}-W${String(parsed.isoWeek).padStart(2, '0')}`,
    isoYear: parsed.isoYear,
    isoWeek: parsed.isoWeek,
    startsAt,
    endsAt,
    weekResetUtcOffset: normalizedOffset,
  };
}

function formatWeekDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}

export function buildWeeklyEventName(weekIdentity: WeekIdentity): string {
  return `Weekly Activity ${weekIdentity.weekKey} (${formatWeekDate(weekIdentity.startsAt)})`;
}

async function resolveWeekResetUtcOffset(
  db: DbClient,
  workspaceId: string,
  requestedOffset?: string | null
): Promise<string> {
  const requested = normalizeWeekResetUtcOffset(requestedOffset);
  if (requested) return requested;

  const settingsClient = (db as EventStoreClient).workspaceSettings;
  if (!settingsClient?.findUnique) return DEFAULT_WEEK_RESET_UTC_OFFSET;

  try {
    const settings = await settingsClient.findUnique({
      where: { workspaceId },
      select: { weekResetUtcOffset: true },
    });
    return (
      normalizeWeekResetUtcOffset(settings?.weekResetUtcOffset) ||
      DEFAULT_WEEK_RESET_UTC_OFFSET
    );
  } catch {
    return DEFAULT_WEEK_RESET_UTC_OFFSET;
  }
}

export async function ensureWeeklyEventForWorkspace(
  workspaceId: string,
  options?: {
    now?: Date;
    tx?: DbClient;
    weekResetUtcOffset?: string | null;
  }
) {
  const db = await getDbClient(options?.tx);
  const weekResetUtcOffset = await resolveWeekResetUtcOffset(
    db,
    workspaceId,
    options?.weekResetUtcOffset
  );
  const identity = getWeekIdentity(options?.now || new Date(), weekResetUtcOffset);

  const existing = await db.event.findFirst({
    where: {
      workspaceId,
      eventType: EventType.WEEKLY,
      weekKey: identity.weekKey,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return {
      event: existing,
      created: false,
      week: identity,
    };
  }

  const createdEvent = await db.event.create({
    data: {
      workspaceId,
      name: buildWeeklyEventName(identity),
      description: `Auto-generated weekly roster tracking window (${identity.weekResetUtcOffset} reset).`,
      eventType: EventType.WEEKLY,
      weekKey: identity.weekKey,
      startsAt: identity.startsAt,
      endsAt: identity.endsAt,
      isAutoGenerated: true,
      isClosed: false,
    },
  });

  return {
    event: createdEvent,
    created: true,
    week: identity,
  };
}

export async function findWeeklyEventByKey(
  workspaceId: string,
  weekKey: string,
  options?: {
    tx?: DbClient;
  }
) {
  const db = await getDbClient(options?.tx);
  return db.event.findFirst({
    where: {
      workspaceId,
      eventType: EventType.WEEKLY,
      weekKey: String(weekKey || '').trim(),
    },
    orderBy: { createdAt: 'desc' },
  });
}
