import crypto from 'node:crypto';
import {
  EmbeddingCorpus,
  EmbeddingTaskOperation,
  EmbeddingTaskStatus,
  Prisma,
  WorkspaceRole,
  type AccessLink,
} from '@prisma/client';
import { ApiHttpError } from '@/lib/api-response';
import { parseAssistantConfigFromJson } from '@/lib/assistant/config';
import {
  createMistralBatchJob,
  pollMistralBatchJobUntilTerminal,
  runMistralEmbeddings,
} from '@/lib/mistral/client';
import { prisma } from '@/lib/prisma';

const EMBEDDING_VECTOR_DIMENSION = 1024;
const DEFAULT_QUERY_TIMEOUT_MS = 25_000;
const EMBEDDING_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const DEFAULT_PROCESS_LIMIT = 32;
const RRF_K = 60;
const EMBEDDING_MARGIN_THRESHOLD = 0.04;
const EMBEDDING_QUERY_CACHE_TTL_MS = 5 * 60 * 1000;

const EMBEDDING_CORPUS_VALUES = new Set<string>(Object.values(EmbeddingCorpus));

type EmbeddingDbClient = Prisma.TransactionClient | typeof prisma;

export type EmbeddingRetrievalMode = 'hybrid' | 'semantic' | 'lexical';

export type EmbeddingSearchHit = {
  documentId: string;
  corpus: EmbeddingCorpus;
  entityType: string;
  entityId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  source: 'vector' | 'lexical' | 'hybrid';
};

export type HybridScoreBreakdown = {
  documentId: string;
  lexicalRank: number | null;
  vectorRank: number | null;
  rrfScore: number;
};

export type EmbeddingSearchResult = {
  hits: EmbeddingSearchHit[];
  diagnostics: {
    mode: EmbeddingRetrievalMode;
    selectedCorpora: EmbeddingCorpus[];
    lexicalCandidates: number;
    semanticCandidates: number;
    fusedCandidates: number;
    droppedCandidates: number;
    estimatedLatencyMs: number;
    model: string;
    dimensions: number;
  };
};

export type EmbeddingStatusSummary = {
  workspaceId: string;
  documents: {
    total: number;
    byCorpus: Record<string, number>;
  };
  tasks: {
    pending: number;
    processing: number;
    failed: number;
    completedLast24h: number;
  };
  config: {
    enabled: boolean;
    model: string;
    dimension: number;
    retrievalMode: EmbeddingRetrievalMode;
    fallbackOnly: boolean;
    maxCandidates: number;
    autoLinkThreshold: number;
    batch: {
      enabled: boolean;
      threshold: number;
    };
  };
};

export type EmbeddingProcessingResult = {
  workspaceId: string;
  attempted: number;
  claimed: number;
  completed: number;
  failed: number;
  skipped: number;
  failures: Array<{
    taskId: string;
    reason: string;
  }>;
};

export type GovernorEmbeddingFallbackCandidate = {
  governorDbId: string;
  governorGameId: string;
  governorName: string;
  score: number;
  documentId: string;
};

export type GovernorEmbeddingFallbackResult =
  | {
      status: 'resolved';
      autoLinkThreshold: number;
      marginThreshold: number;
      governor: GovernorEmbeddingFallbackCandidate;
      candidates: GovernorEmbeddingFallbackCandidate[];
      reason: string;
    }
  | {
      status: 'ambiguous' | 'unresolved';
      autoLinkThreshold: number;
      marginThreshold: number;
      candidates: GovernorEmbeddingFallbackCandidate[];
      reason: string;
    };

type EmbeddingConfig = {
  enabled: boolean;
  model: string;
  dimension: number;
  retrievalMode: EmbeddingRetrievalMode;
  maxCandidates: number;
  fallbackOnly: boolean;
  autoLinkThreshold: number;
  batch: {
    enabled: boolean;
    threshold: number;
  };
};

type QueueTaskRow = {
  id: string;
  workspaceId: string;
  corpus: EmbeddingCorpus;
  operation: EmbeddingTaskOperation;
  entityType: string;
  entityId: string | null;
  payload: Prisma.JsonValue | null;
  attemptCount: number;
};

type EmbeddingSourceDocument = {
  chunkIndex: number;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
};

type VectorRow = {
  id: string;
  corpus: string;
  entityType: string;
  entityId: string;
  chunkIndex: number;
  content: string;
  metadata: Prisma.JsonValue | null;
  similarity: number;
};

const queryEmbeddingCache = new Map<string, { vector: number[]; expiresAt: number }>();

function sanitizePrintable(value: unknown, maxLen = 8000): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toSafeCorpus(value: string): EmbeddingCorpus {
  const normalized = String(value || '').trim().toUpperCase();
  if (!EMBEDDING_CORPUS_VALUES.has(normalized)) {
    throw new ApiHttpError('VALIDATION_ERROR', `Unsupported embedding corpus: ${value}`, 400);
  }
  return normalized as EmbeddingCorpus;
}

function normalizeEmbeddingConfig(raw: unknown): EmbeddingConfig {
  const parsed = parseAssistantConfigFromJson(raw);
  const model = sanitizePrintable(parsed.embedding.model, 120) || 'mistral-embed-2312';
  const configuredDimension = Number.isFinite(parsed.embedding.dimension)
    ? Math.floor(Number(parsed.embedding.dimension))
    : EMBEDDING_VECTOR_DIMENSION;
  const dimension =
    configuredDimension === EMBEDDING_VECTOR_DIMENSION
      ? configuredDimension
      : EMBEDDING_VECTOR_DIMENSION;

  return {
    enabled: Boolean(parsed.embedding.enabled),
    model,
    dimension,
    retrievalMode: parsed.embedding.retrievalMode,
    maxCandidates: Math.max(1, Math.min(200, Number(parsed.embedding.maxCandidates || 24))),
    fallbackOnly: Boolean(parsed.embedding.fallbackOnly),
    autoLinkThreshold: Math.max(0.7, Math.min(1, Number(parsed.embedding.autoLinkThreshold || 0.93))),
    batch: {
      enabled: Boolean(parsed.embedding.batch.enabled),
      threshold: Math.max(20, Math.min(100000, Number(parsed.embedding.batch.threshold || 80))),
    },
  };
}

async function readWorkspaceEmbeddingConfig(workspaceId: string): Promise<EmbeddingConfig> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { workspaceId },
    select: { assistantConfig: true },
  });
  return normalizeEmbeddingConfig(settings?.assistantConfig);
}

function splitIntoChunks(input: string, maxChars = 1400): string[] {
  const normalized = sanitizePrintable(input, 40_000);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const lines = normalized
    .split(/\n+/g)
    .map((row) => sanitizePrintable(row, maxChars))
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (!line) continue;
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    if (line.length > maxChars) {
      for (let offset = 0; offset < line.length; offset += maxChars) {
        const slice = line.slice(offset, offset + maxChars);
        if (slice) chunks.push(slice);
      }
      current = '';
      continue;
    }
    current = line;
  }
  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

function hashText(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function toVectorLiteral(vector: number[]): string {
  const numbers = vector.map((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(n);
  });
  return `[${numbers.join(',')}]`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lexicalScore(query: string, content: string): number {
  const q = sanitizePrintable(query, 600).toLowerCase();
  const body = sanitizePrintable(content, 6000).toLowerCase();
  if (!q || !body) return 0;
  if (body.includes(q)) return 1;

  const qTokens = q.split(/\s+/g).filter((token) => token.length > 1);
  if (qTokens.length === 0) return 0;
  let matched = 0;
  for (const token of qTokens) {
    if (body.includes(token)) {
      matched += 1;
    }
  }
  return clamp01(matched / qTokens.length);
}

function nextRetryAt(attemptCount: number): Date {
  const delay = Math.min(EMBEDDING_RETRY_MAX_DELAY_MS, 1000 * 2 ** Math.min(12, attemptCount));
  return new Date(Date.now() + delay);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

function assertWorkspaceEditor(link: AccessLink): void {
  if (link.role !== WorkspaceRole.OWNER && link.role !== WorkspaceRole.EDITOR) {
    throw new ApiHttpError('FORBIDDEN', 'Requires editor access.', 403);
  }
}

async function embedTextsSequential(args: {
  texts: string[];
  model: string;
  dimension: number;
}): Promise<number[][]> {
  const response = await runMistralEmbeddings({
    input: args.texts,
    model: args.model,
    outputDimension: args.dimension,
    outputDtype: 'float',
    encodingFormat: 'float',
  });

  const ordered = [...response.data].sort((a, b) => a.index - b.index);
  return ordered.map((row) => {
    if (!Array.isArray(row.embedding)) {
      throw new ApiHttpError('INTERNAL_ERROR', 'Mistral embedding output is not a float vector.', 502);
    }
    return row.embedding.map((value) => Number(value));
  });
}

async function embedTextsViaBatch(args: {
  texts: string[];
  model: string;
  dimension: number;
}): Promise<number[][]> {
  const requests = args.texts.map((text, index) => ({
    custom_id: String(index),
    body: {
      model: args.model,
      input: text,
      output_dimension: args.dimension,
      output_dtype: 'float',
      encoding_format: 'float',
    },
  }));

  const created = await createMistralBatchJob({
    endpoint: '/v1/embeddings',
    model: args.model,
    requests,
    timeoutHours: 24,
    metadata: {
      source: 'workspace_embedding_indexer',
      requestCount: args.texts.length,
    },
  });

  const completed = await pollMistralBatchJobUntilTerminal({
    jobId: created.id,
    inline: true,
    timeoutMs: 12 * 60 * 1000,
    pollIntervalMs: 5000,
  });

  if (completed.status !== 'SUCCESS') {
    throw new ApiHttpError(
      'INTERNAL_ERROR',
      `Mistral embedding batch failed with status ${completed.status}.`,
      502,
      {
        batchJobId: completed.id,
      }
    );
  }

  const outputs = Array.isArray(completed.outputs) ? completed.outputs : [];
  const vectorsByIndex = new Map<number, number[]>();
  for (const raw of outputs) {
    const row = asJsonObject(raw);
    const customId = Number(row.custom_id ?? row.customId ?? row.request_id ?? row.id);
    if (!Number.isFinite(customId)) continue;

    const responseRow = asJsonObject(row.response);
    const body =
      asJsonObject(responseRow.body).data ||
      asJsonObject(row.body).data ||
      asJsonObject(row.output).data ||
      asJsonObject(row.result).data;

    const dataRows = Array.isArray(body) ? body : [];
    const first = dataRows[0] && typeof dataRows[0] === 'object' ? asJsonObject(dataRows[0]) : null;
    if (!first || !Array.isArray(first.embedding)) continue;
    vectorsByIndex.set(customId, first.embedding.map((value) => Number(value)));
  }

  const vectors: number[][] = [];
  for (let index = 0; index < args.texts.length; index += 1) {
    const vector = vectorsByIndex.get(index);
    if (!vector) {
      throw new ApiHttpError(
        'INTERNAL_ERROR',
        `Missing embedding output for batch index ${index}.`,
        502
      );
    }
    vectors.push(vector);
  }

  return vectors;
}

async function embedTexts(args: {
  texts: string[];
  config: EmbeddingConfig;
}): Promise<number[][]> {
  const model = args.config.model;
  // The table index is provisioned for vector(1024) in this phase.
  const dimension = EMBEDDING_VECTOR_DIMENSION;
  if (args.texts.length === 0) return [];

  if (args.config.batch.enabled && args.texts.length >= args.config.batch.threshold) {
    try {
      return await embedTextsViaBatch({
        texts: args.texts,
        model,
        dimension,
      });
    } catch {
      // Fall back to sequential embedding when batch fails.
    }
  }

  return embedTextsSequential({
    texts: args.texts,
    model,
    dimension,
  });
}

async function upsertEmbeddingDocuments(args: {
  workspaceId: string;
  corpus: EmbeddingCorpus;
  entityType: string;
  entityId: string;
  model: string;
  docs: EmbeddingSourceDocument[];
  vectors: number[][];
}): Promise<void> {
  for (let index = 0; index < args.docs.length; index += 1) {
    const doc = args.docs[index];
    const vector = args.vectors[index] || [];
    if (vector.length !== EMBEDDING_VECTOR_DIMENSION) {
      throw new ApiHttpError(
        'INTERNAL_ERROR',
        `Embedding dimension mismatch: expected ${EMBEDDING_VECTOR_DIMENSION}, received ${vector.length}.`,
        502
      );
    }

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "EmbeddingDocument" (
        "id",
        "workspaceId",
        "corpus",
        "entityType",
        "entityId",
        "chunkIndex",
        "content",
        "contentHash",
        "model",
        "dimensions",
        "embedding",
        "metadata",
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1,
        $2,
        $3::"EmbeddingCorpus",
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::vector,
        $12::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT ("workspaceId", "corpus", "entityType", "entityId", "chunkIndex", "model")
      DO UPDATE SET
        "content" = EXCLUDED."content",
        "contentHash" = EXCLUDED."contentHash",
        "dimensions" = EXCLUDED."dimensions",
        "embedding" = EXCLUDED."embedding",
        "metadata" = EXCLUDED."metadata",
        "updatedAt" = NOW()
      `,
      crypto.randomUUID(),
      args.workspaceId,
      args.corpus,
      args.entityType,
      args.entityId,
      doc.chunkIndex,
      doc.content,
      doc.contentHash,
      args.model,
      EMBEDDING_VECTOR_DIMENSION,
      toVectorLiteral(vector),
      JSON.stringify(doc.metadata || {})
    );
  }

  await prisma.$executeRawUnsafe(
    `
    DELETE FROM "EmbeddingDocument"
    WHERE "workspaceId" = $1
      AND "corpus" = $2::"EmbeddingCorpus"
      AND "entityType" = $3
      AND "entityId" = $4
      AND "model" = $5
      AND "chunkIndex" >= $6
    `,
    args.workspaceId,
    args.corpus,
    args.entityType,
    args.entityId,
    args.model,
    args.docs.length
  );
}

async function deleteEmbeddingDocuments(args: {
  workspaceId: string;
  corpus: EmbeddingCorpus;
  entityType: string;
  entityId: string;
}): Promise<void> {
  await prisma.embeddingDocument.deleteMany({
    where: {
      workspaceId: args.workspaceId,
      corpus: args.corpus,
      entityType: args.entityType,
      entityId: args.entityId,
    },
  });
}

function toOcrExtractionContent(row: {
  id: string;
  governorIdRaw: string | null;
  governorNameRaw: string | null;
  confidence: number;
  lowConfidence: boolean;
  fields: Prisma.JsonValue;
  normalized: Prisma.JsonValue | null;
  failureReasons: Prisma.JsonValue | null;
  engineVersion: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`OCR Extraction ${row.id}`);
  lines.push(`Governor ID: ${row.governorIdRaw || '-'}`);
  lines.push(`Governor Name: ${row.governorNameRaw || '-'}`);
  lines.push(`Confidence: ${row.confidence}`);
  lines.push(`Low confidence: ${row.lowConfidence ? 'yes' : 'no'}`);
  lines.push(`Engine: ${row.engineVersion || '-'}`);

  const normalized = asJsonObject(row.normalized);
  const fields = asJsonObject(row.fields);
  const failure = Array.isArray(row.failureReasons) ? row.failureReasons : [];

  if (Object.keys(normalized).length > 0) {
    lines.push(`Normalized: ${JSON.stringify(normalized)}`);
  }
  if (Object.keys(fields).length > 0) {
    lines.push(`Fields: ${JSON.stringify(fields)}`);
  }
  if (failure.length > 0) {
    lines.push(`Failure reasons: ${JSON.stringify(failure)}`);
  }

  return lines.join('\n');
}

function buildChunkedDocuments(args: {
  content: string;
  metadata: Record<string, unknown>;
}): EmbeddingSourceDocument[] {
  const chunks = splitIntoChunks(args.content, 1400);
  return chunks.map((content, chunkIndex) => ({
    chunkIndex,
    content,
    contentHash: hashText(content),
    metadata: {
      ...args.metadata,
      chunkIndex,
    },
  }));
}

async function buildDocumentsForTask(task: QueueTaskRow): Promise<EmbeddingSourceDocument[]> {
  if (!task.entityId) return [];

  switch (task.corpus) {
    case EmbeddingCorpus.GOVERNOR_IDENTITY: {
      const governor = await prisma.governor.findFirst({
        where: {
          id: task.entityId,
          workspaceId: task.workspaceId,
        },
        select: {
          id: true,
          governorId: true,
          name: true,
          alliance: true,
          aliases: {
            where: {
              workspaceId: task.workspaceId,
            },
            select: {
              aliasRaw: true,
              aliasNormalized: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
            take: 120,
          },
        },
      });

      if (!governor) return [];

      const aliases = governor.aliases
        .map((row) => row.aliasRaw || row.aliasNormalized)
        .filter((row) => Boolean(String(row || '').trim()));

      const content = [
        `Governor: ${governor.name}`,
        `Governor ID: ${governor.governorId}`,
        `Alliance: ${governor.alliance || '-'}`,
        `Aliases: ${aliases.join(' | ') || '-'}`,
      ].join('\n');

      return buildChunkedDocuments({
        content,
        metadata: {
          source: 'governor_identity',
          governorId: governor.id,
          governorGameId: governor.governorId,
        },
      });
    }

    case EmbeddingCorpus.EVENTS: {
      const event = await prisma.event.findFirst({
        where: {
          id: task.entityId,
          workspaceId: task.workspaceId,
        },
        select: {
          id: true,
          name: true,
          description: true,
          eventType: true,
          weekKey: true,
          isClosed: true,
          startsAt: true,
          endsAt: true,
        },
      });

      if (!event) return [];

      const content = [
        `Event: ${event.name}`,
        `Type: ${event.eventType}`,
        `Description: ${event.description || '-'}`,
        `Week Key: ${event.weekKey || '-'}`,
        `Closed: ${event.isClosed ? 'yes' : 'no'}`,
        `Starts: ${event.startsAt ? event.startsAt.toISOString() : '-'}`,
        `Ends: ${event.endsAt ? event.endsAt.toISOString() : '-'}`,
      ].join('\n');

      return buildChunkedDocuments({
        content,
        metadata: {
          source: 'events',
          eventId: event.id,
        },
      });
    }

    case EmbeddingCorpus.OCR_EXTRACTIONS: {
      const extraction = await prisma.ocrExtraction.findFirst({
        where: {
          id: task.entityId,
          scanJob: {
            workspaceId: task.workspaceId,
          },
        },
        select: {
          id: true,
          governorIdRaw: true,
          governorNameRaw: true,
          confidence: true,
          lowConfidence: true,
          fields: true,
          normalized: true,
          failureReasons: true,
          engineVersion: true,
        },
      });

      if (!extraction) return [];

      return buildChunkedDocuments({
        content: toOcrExtractionContent(extraction),
        metadata: {
          source: 'ocr_extractions',
          extractionId: extraction.id,
          confidence: extraction.confidence,
          lowConfidence: extraction.lowConfidence,
        },
      });
    }

    case EmbeddingCorpus.RANKING: {
      const run = await prisma.rankingRun.findFirst({
        where: {
          id: task.entityId,
          workspaceId: task.workspaceId,
        },
        select: {
          id: true,
          rankingType: true,
          metricKey: true,
          headerText: true,
          status: true,
          rows: {
            orderBy: [{ sourceRank: 'asc' }, { metricValue: 'desc' }],
            select: {
              sourceRank: true,
              governorNameRaw: true,
              metricRaw: true,
              metricValue: true,
              allianceRaw: true,
              identityStatus: true,
            },
            take: 240,
          },
        },
      });

      if (!run) return [];

      const header = [
        `Ranking Run ${run.id}`,
        `Type: ${run.rankingType}`,
        `Metric Key: ${run.metricKey}`,
        `Header: ${run.headerText || '-'}`,
        `Status: ${run.status}`,
      ].join('\n');

      const rowLines = run.rows.map((row, index) => {
        const metric = row.metricValue != null ? row.metricValue.toString() : row.metricRaw;
        return `${row.sourceRank ?? index + 1}. ${row.governorNameRaw} | alliance=${row.allianceRaw || '-'} | metric=${metric} | status=${row.identityStatus}`;
      });

      const content = [header, ...rowLines].join('\n');
      return buildChunkedDocuments({
        content,
        metadata: {
          source: 'ranking',
          runId: run.id,
          rowCount: run.rows.length,
        },
      });
    }

    case EmbeddingCorpus.ASSISTANT_AUDIT: {
      if (task.entityType === 'assistant_plan') {
        const plan = await prisma.assistantPlan.findFirst({
          where: {
            id: task.entityId,
            workspaceId: task.workspaceId,
          },
          select: {
            id: true,
            summary: true,
            status: true,
            actionsJson: true,
            createdAt: true,
          },
        });

        if (!plan) return [];

        const content = [
          `Assistant Plan ${plan.id}`,
          `Status: ${plan.status}`,
          `Created: ${plan.createdAt.toISOString()}`,
          `Summary: ${plan.summary}`,
          `Actions: ${JSON.stringify(plan.actionsJson)}`,
        ].join('\n');

        return buildChunkedDocuments({
          content,
          metadata: {
            source: 'assistant_audit',
            entityType: 'assistant_plan',
            planId: plan.id,
          },
        });
      }

      if (task.entityType === 'assistant_pending_identity') {
        const pending = await prisma.assistantPendingIdentity.findFirst({
          where: {
            id: task.entityId,
            workspaceId: task.workspaceId,
          },
          select: {
            id: true,
            status: true,
            reason: true,
            governorIdRaw: true,
            governorNameRaw: true,
            payload: true,
            candidateGovernorIds: true,
            createdAt: true,
          },
        });

        if (!pending) return [];

        const content = [
          `Pending Identity ${pending.id}`,
          `Status: ${pending.status}`,
          `Reason: ${pending.reason || '-'}`,
          `Governor ID Raw: ${pending.governorIdRaw || '-'}`,
          `Governor Name Raw: ${pending.governorNameRaw || '-'}`,
          `Payload: ${JSON.stringify(pending.payload)}`,
          `Candidates: ${JSON.stringify(pending.candidateGovernorIds || [])}`,
        ].join('\n');

        return buildChunkedDocuments({
          content,
          metadata: {
            source: 'assistant_audit',
            entityType: 'assistant_pending_identity',
            pendingIdentityId: pending.id,
            createdAt: pending.createdAt.toISOString(),
          },
        });
      }

      return [];
    }

    default:
      return [];
  }
}

async function processSingleEmbeddingTask(task: QueueTaskRow): Promise<void> {
  if (!task.entityId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'Embedding task entityId is required.', 400);
  }

  if (task.operation === EmbeddingTaskOperation.DELETE) {
    await deleteEmbeddingDocuments({
      workspaceId: task.workspaceId,
      corpus: task.corpus,
      entityType: task.entityType,
      entityId: task.entityId,
    });
    return;
  }

  const config = await readWorkspaceEmbeddingConfig(task.workspaceId);
  if (!config.enabled) {
    return;
  }

  const docs = await buildDocumentsForTask(task);
  if (docs.length === 0) {
    await deleteEmbeddingDocuments({
      workspaceId: task.workspaceId,
      corpus: task.corpus,
      entityType: task.entityType,
      entityId: task.entityId,
    });
    return;
  }

  const vectors = await embedTexts({
    texts: docs.map((doc) => doc.content),
    config,
  });

  await upsertEmbeddingDocuments({
    workspaceId: task.workspaceId,
    corpus: task.corpus,
    entityType: task.entityType,
    entityId: task.entityId,
    model: config.model,
    docs,
    vectors,
  });
}

export async function enqueueEmbeddingTask(args: {
  workspaceId: string;
  corpus: EmbeddingCorpus;
  operation: EmbeddingTaskOperation;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
  client?: EmbeddingDbClient;
}): Promise<void> {
  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required for embedding task.', 400);
  }

  const entityType = sanitizePrintable(args.entityType, 80);
  if (!entityType) {
    throw new ApiHttpError('VALIDATION_ERROR', 'entityType is required for embedding task.', 400);
  }

  const entityId = sanitizePrintable(args.entityId || '', 80) || null;
  const db = args.client || prisma;

  await db.embeddingTask.create({
    data: {
      workspaceId,
      corpus: args.corpus,
      operation: args.operation,
      entityType,
      entityId,
      payload: toJsonValue(args.payload),
      status: EmbeddingTaskStatus.PENDING,
      availableAt: new Date(),
    },
  });
}

export async function enqueueEmbeddingTaskSafe(args: {
  workspaceId: string;
  corpus: EmbeddingCorpus;
  operation: EmbeddingTaskOperation;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
  client?: EmbeddingDbClient;
}): Promise<void> {
  try {
    await enqueueEmbeddingTask(args);
  } catch (error) {
    console.error('enqueueEmbeddingTaskSafe failed', {
      workspaceId: args.workspaceId,
      corpus: args.corpus,
      operation: args.operation,
      entityType: args.entityType,
      entityId: args.entityId || null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildTaskRows(args: {
  workspaceId: string;
  corpus: EmbeddingCorpus;
  operation: EmbeddingTaskOperation;
  entityType: string;
  ids: string[];
  payload?: Record<string, unknown>;
}): Prisma.EmbeddingTaskCreateManyInput[] {
  return args.ids.map((id) => ({
    workspaceId: args.workspaceId,
    corpus: args.corpus,
    operation: args.operation,
    entityType: args.entityType,
    entityId: id,
    payload: toJsonValue(args.payload),
    status: EmbeddingTaskStatus.PENDING,
    availableAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    attemptCount: 0,
  }));
}

async function createManyTasksInChunks(
  db: EmbeddingDbClient,
  rows: Prisma.EmbeddingTaskCreateManyInput[],
  chunkSize = 400
): Promise<number> {
  let total = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    const created = await db.embeddingTask.createMany({
      data: chunk,
    });
    total += created.count;
  }
  return total;
}

export async function enqueueWorkspaceEmbeddingBackfill(args: {
  workspaceId: string;
  accessLink: AccessLink;
}): Promise<{ workspaceId: string; queued: number; byCorpus: Record<string, number> }> {
  assertWorkspaceEditor(args.accessLink);
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }

  const [governors, events, extractions, rankingRuns, plans, pendingIdentities] = await Promise.all([
    prisma.governor.findMany({ where: { workspaceId }, select: { id: true } }),
    prisma.event.findMany({ where: { workspaceId }, select: { id: true } }),
    prisma.ocrExtraction.findMany({ where: { scanJob: { workspaceId } }, select: { id: true } }),
    prisma.rankingRun.findMany({ where: { workspaceId }, select: { id: true } }),
    prisma.assistantPlan.findMany({ where: { workspaceId }, select: { id: true } }),
    prisma.assistantPendingIdentity.findMany({ where: { workspaceId }, select: { id: true } }),
  ]);

  const payload = {
    reason: 'workspace_backfill',
    requestedByLinkId: args.accessLink.id,
    requestedAt: new Date().toISOString(),
  };

  const rows = [
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.GOVERNOR_IDENTITY,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'governor',
      ids: governors.map((row) => row.id),
      payload,
    }),
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.EVENTS,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'event',
      ids: events.map((row) => row.id),
      payload,
    }),
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.OCR_EXTRACTIONS,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'ocr_extraction',
      ids: extractions.map((row) => row.id),
      payload,
    }),
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.RANKING,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'ranking_run',
      ids: rankingRuns.map((row) => row.id),
      payload,
    }),
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.ASSISTANT_AUDIT,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'assistant_plan',
      ids: plans.map((row) => row.id),
      payload,
    }),
    ...buildTaskRows({
      workspaceId,
      corpus: EmbeddingCorpus.ASSISTANT_AUDIT,
      operation: EmbeddingTaskOperation.BACKFILL,
      entityType: 'assistant_pending_identity',
      ids: pendingIdentities.map((row) => row.id),
      payload,
    }),
  ];

  const queued = await createManyTasksInChunks(prisma, rows);

  return {
    workspaceId,
    queued,
    byCorpus: {
      [EmbeddingCorpus.GOVERNOR_IDENTITY]: governors.length,
      [EmbeddingCorpus.EVENTS]: events.length,
      [EmbeddingCorpus.OCR_EXTRACTIONS]: extractions.length,
      [EmbeddingCorpus.RANKING]: rankingRuns.length,
      [EmbeddingCorpus.ASSISTANT_AUDIT]: plans.length + pendingIdentities.length,
    },
  };
}

export async function reindexWorkspaceEmbeddings(args: {
  workspaceId: string;
  accessLink: AccessLink;
}): Promise<{ workspaceId: string; deletedDocuments: number; deletedTasks: number; queued: number }> {
  assertWorkspaceEditor(args.accessLink);
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const deletedDocuments = await tx.embeddingDocument.deleteMany({
      where: { workspaceId },
    });
    const deletedTasks = await tx.embeddingTask.deleteMany({
      where: { workspaceId },
    });
    return {
      deletedDocuments: deletedDocuments.count,
      deletedTasks: deletedTasks.count,
    };
  });

  const queued = await enqueueWorkspaceEmbeddingBackfill({
    workspaceId,
    accessLink: args.accessLink,
  });

  return {
    workspaceId,
    deletedDocuments: deleted.deletedDocuments,
    deletedTasks: deleted.deletedTasks,
    queued: queued.queued,
  };
}

export async function getWorkspaceEmbeddingStatus(args: {
  workspaceId: string;
  accessLink: AccessLink;
}): Promise<EmbeddingStatusSummary> {
  if (args.accessLink.workspaceId !== args.workspaceId) {
    throw new ApiHttpError('FORBIDDEN', 'Access link is not valid for this workspace.', 403);
  }

  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }

  const [documentsTotal, docsByCorpusRows, pending, processing, failed, completedLast24h, config] =
    await Promise.all([
      prisma.embeddingDocument.count({ where: { workspaceId } }),
      prisma.embeddingDocument.groupBy({
        by: ['corpus'],
        where: { workspaceId },
        _count: {
          _all: true,
        },
      }),
      prisma.embeddingTask.count({
        where: {
          workspaceId,
          status: EmbeddingTaskStatus.PENDING,
        },
      }),
      prisma.embeddingTask.count({
        where: {
          workspaceId,
          status: EmbeddingTaskStatus.PROCESSING,
        },
      }),
      prisma.embeddingTask.count({
        where: {
          workspaceId,
          status: EmbeddingTaskStatus.FAILED,
        },
      }),
      prisma.embeddingTask.count({
        where: {
          workspaceId,
          status: EmbeddingTaskStatus.COMPLETED,
          completedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      readWorkspaceEmbeddingConfig(workspaceId),
    ]);

  const byCorpus: Record<string, number> = {};
  for (const row of docsByCorpusRows) {
    byCorpus[row.corpus] = row._count._all;
  }

  return {
    workspaceId,
    documents: {
      total: documentsTotal,
      byCorpus,
    },
    tasks: {
      pending,
      processing,
      failed,
      completedLast24h,
    },
    config,
  };
}

export async function processEmbeddingTasks(args: {
  workspaceId: string;
  limit?: number;
}): Promise<EmbeddingProcessingResult> {
  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }

  const limit = Math.max(1, Math.min(200, Number(args.limit || DEFAULT_PROCESS_LIMIT)));
  const now = new Date();

  const candidates = await prisma.embeddingTask.findMany({
    where: {
      workspaceId,
      status: {
        in: [EmbeddingTaskStatus.PENDING, EmbeddingTaskStatus.FAILED],
      },
      availableAt: {
        lte: now,
      },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      corpus: true,
      operation: true,
      entityType: true,
      entityId: true,
      payload: true,
      attemptCount: true,
      status: true,
    },
  });

  const failures: Array<{ taskId: string; reason: string }> = [];
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const claimedUpdate = await prisma.embeddingTask.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
      },
      data: {
        status: EmbeddingTaskStatus.PROCESSING,
        startedAt: new Date(),
        lastError: null,
        attemptCount: {
          increment: 1,
        },
      },
    });

    if (claimedUpdate.count === 0) {
      skipped += 1;
      continue;
    }

    claimed += 1;

    const task: QueueTaskRow = {
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      corpus: candidate.corpus,
      operation: candidate.operation,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      payload: candidate.payload,
      attemptCount: candidate.attemptCount + 1,
    };

    try {
      await processSingleEmbeddingTask(task);
      await prisma.embeddingTask.update({
        where: { id: task.id },
        data: {
          status: EmbeddingTaskStatus.COMPLETED,
          completedAt: new Date(),
          lastError: null,
        },
      });
      completed += 1;
    } catch (error) {
      failed += 1;
      const reason = sanitizePrintable(error instanceof Error ? error.message : 'Embedding task failed.', 500);
      failures.push({ taskId: task.id, reason });

      await prisma.embeddingTask.update({
        where: { id: task.id },
        data: {
          status: EmbeddingTaskStatus.FAILED,
          lastError: reason,
          availableAt: nextRetryAt(task.attemptCount),
        },
      });
    }
  }

  return {
    workspaceId,
    attempted: candidates.length,
    claimed,
    completed,
    failed,
    skipped,
    failures,
  };
}

async function getQueryEmbedding(args: {
  model: string;
  query: string;
  dimension: number;
}): Promise<number[]> {
  const normalized = sanitizePrintable(args.query, 1200);
  if (!normalized) return [];

  const cacheKey = `${args.model}::${normalized.toLowerCase()}`;
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.vector;
  }

  const rows = await embedTextsSequential({
    texts: [normalized],
    model: args.model,
    dimension: EMBEDDING_VECTOR_DIMENSION,
  });
  const vector = rows[0] || [];
  queryEmbeddingCache.set(cacheKey, {
    vector,
    expiresAt: Date.now() + EMBEDDING_QUERY_CACHE_TTL_MS,
  });
  return vector;
}

function normalizeCorpora(input?: EmbeddingCorpus[]): EmbeddingCorpus[] {
  if (!input || input.length === 0) {
    return [
      EmbeddingCorpus.GOVERNOR_IDENTITY,
      EmbeddingCorpus.EVENTS,
      EmbeddingCorpus.OCR_EXTRACTIONS,
      EmbeddingCorpus.RANKING,
      EmbeddingCorpus.ASSISTANT_AUDIT,
    ];
  }
  const seen = new Set<EmbeddingCorpus>();
  for (const row of input) {
    seen.add(toSafeCorpus(row));
  }
  return [...seen.values()];
}

async function runVectorSearch(args: {
  workspaceId: string;
  corpora: EmbeddingCorpus[];
  queryVector: number[];
  limit: number;
}): Promise<VectorRow[]> {
  if (args.queryVector.length === 0 || args.corpora.length === 0) return [];

  const corpusSql = args.corpora.map((corpus) => `'${corpus}'::"EmbeddingCorpus"`).join(', ');
  const rows = await prisma.$queryRawUnsafe<VectorRow[]>(
    `
    SELECT
      "id",
      "corpus"::text AS "corpus",
      "entityType",
      "entityId",
      "chunkIndex",
      "content",
      "metadata",
      (1 - ("embedding" <=> $2::vector))::float8 AS "similarity"
    FROM "EmbeddingDocument"
    WHERE "workspaceId" = $1
      AND "corpus" IN (${corpusSql})
    ORDER BY "embedding" <=> $2::vector
    LIMIT $3
    `,
    args.workspaceId,
    toVectorLiteral(args.queryVector),
    args.limit
  );

  return rows;
}

export async function searchWorkspaceEmbeddings(args: {
  workspaceId: string;
  query: string;
  corpora?: EmbeddingCorpus[];
  mode?: EmbeddingRetrievalMode;
  maxCandidates?: number;
  timeoutMs?: number;
}): Promise<EmbeddingSearchResult> {
  const startedAt = Date.now();
  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  const query = sanitizePrintable(args.query, 1200);
  if (!workspaceId) {
    throw new ApiHttpError('VALIDATION_ERROR', 'workspaceId is required.', 400);
  }
  if (!query) {
    return {
      hits: [],
      diagnostics: {
        mode: args.mode || 'hybrid',
        selectedCorpora: normalizeCorpora(args.corpora),
        lexicalCandidates: 0,
        semanticCandidates: 0,
        fusedCandidates: 0,
        droppedCandidates: 0,
        estimatedLatencyMs: 0,
        model: 'mistral-embed-2312',
        dimensions: EMBEDDING_VECTOR_DIMENSION,
      },
    };
  }

  const config = await readWorkspaceEmbeddingConfig(workspaceId);
  const selectedCorpora = normalizeCorpora(args.corpora);
  const mode = args.mode || config.retrievalMode;
  const limit = Math.max(1, Math.min(200, Number(args.maxCandidates || config.maxCandidates || 24)));
  const timeoutMs = Math.max(1000, Number(args.timeoutMs || DEFAULT_QUERY_TIMEOUT_MS));

  const lexicalPromise = mode === 'hybrid' || mode === 'lexical'
    ? prisma.embeddingDocument.findMany({
        where: {
          workspaceId,
          corpus: {
            in: selectedCorpora,
          },
          content: {
            contains: query,
            mode: 'insensitive',
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
        select: {
          id: true,
          corpus: true,
          entityType: true,
          entityId: true,
          chunkIndex: true,
          content: true,
          metadata: true,
        },
      })
    : Promise.resolve([]);

  const semanticPromise =
    mode === 'hybrid' || mode === 'semantic'
      ? (async () => {
          if (!config.enabled) return [] as VectorRow[];
          const queryVector = await Promise.race([
            getQueryEmbedding({
              model: config.model,
              query,
              dimension: EMBEDDING_VECTOR_DIMENSION,
            }),
            new Promise<number[]>((_, reject) =>
              setTimeout(() => reject(new Error('Embedding query timed out.')), timeoutMs)
            ),
          ]);
          return runVectorSearch({
            workspaceId,
            corpora: selectedCorpora,
            queryVector,
            limit,
          });
        })().catch(() => [] as VectorRow[])
      : Promise.resolve([] as VectorRow[]);

  const [lexicalRows, semanticRows] = await Promise.all([lexicalPromise, semanticPromise]);

  const lexicalHits = lexicalRows.map((row, index) => ({
    documentId: row.id,
    corpus: row.corpus,
    entityType: row.entityType,
    entityId: row.entityId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    metadata: asJsonObject(row.metadata),
    similarity: lexicalScore(query, row.content),
    lexicalRank: index + 1,
    vectorRank: null,
    fusedScore: 0,
    source: 'lexical' as const,
  }));

  const vectorHits = semanticRows.map((row, index) => ({
    documentId: row.id,
    corpus: toSafeCorpus(row.corpus),
    entityType: row.entityType,
    entityId: row.entityId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    metadata: asJsonObject(row.metadata),
    similarity: clamp01(Number(row.similarity || 0)),
    lexicalRank: null,
    vectorRank: index + 1,
    fusedScore: 0,
    source: 'vector' as const,
  }));

  const fused = new Map<string, EmbeddingSearchHit>();

  const addRrf = (doc: EmbeddingSearchHit, rank: number, key: 'lexicalRank' | 'vectorRank') => {
    const prev = fused.get(doc.documentId);
    const score = 1 / (RRF_K + rank);

    if (!prev) {
      const next: EmbeddingSearchHit = {
        ...doc,
        lexicalRank: key === 'lexicalRank' ? rank : null,
        vectorRank: key === 'vectorRank' ? rank : null,
        fusedScore: score,
        source: mode === 'hybrid' ? 'hybrid' : doc.source,
      };
      fused.set(doc.documentId, next);
      return;
    }

    prev.fusedScore += score;
    prev.similarity = Math.max(prev.similarity, doc.similarity);
    if (key === 'lexicalRank') {
      prev.lexicalRank = rank;
    }
    if (key === 'vectorRank') {
      prev.vectorRank = rank;
    }
  };

  if (mode === 'lexical') {
    for (let i = 0; i < lexicalHits.length; i += 1) {
      addRrf(lexicalHits[i], i + 1, 'lexicalRank');
    }
  } else if (mode === 'semantic') {
    for (let i = 0; i < vectorHits.length; i += 1) {
      addRrf(vectorHits[i], i + 1, 'vectorRank');
    }
  } else {
    for (let i = 0; i < vectorHits.length; i += 1) {
      addRrf(vectorHits[i], i + 1, 'vectorRank');
    }
    for (let i = 0; i < lexicalHits.length; i += 1) {
      addRrf(lexicalHits[i], i + 1, 'lexicalRank');
    }
  }

  const hits = [...fused.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || b.similarity - a.similarity)
    .slice(0, limit)
    .map((row) => ({
      ...row,
      similarity: clamp01(row.similarity),
      fusedScore: Number(row.fusedScore.toFixed(8)),
    }));

  return {
    hits,
    diagnostics: {
      mode,
      selectedCorpora,
      lexicalCandidates: lexicalHits.length,
      semanticCandidates: vectorHits.length,
      fusedCandidates: hits.length,
      droppedCandidates: Math.max(0, fused.size - hits.length),
      estimatedLatencyMs: Date.now() - startedAt,
      model: config.model,
      dimensions: EMBEDDING_VECTOR_DIMENSION,
    },
  };
}

export async function resolveGovernorByEmbeddingFallback(args: {
  workspaceId: string;
  query: string;
  suggestionLimit?: number;
  autoLinkThreshold?: number;
  marginThreshold?: number;
}): Promise<GovernorEmbeddingFallbackResult> {
  const workspaceId = sanitizePrintable(args.workspaceId, 60);
  const query = sanitizePrintable(args.query, 180);
  const suggestionLimit = Math.max(1, Math.min(20, Number(args.suggestionLimit || 5)));
  if (!workspaceId || !query) {
    return {
      status: 'unresolved',
      autoLinkThreshold: Math.max(0.7, Math.min(1, Number(args.autoLinkThreshold || 0.93))),
      marginThreshold: Math.max(0, Math.min(0.25, Number(args.marginThreshold || EMBEDDING_MARGIN_THRESHOLD))),
      candidates: [],
      reason: 'Embedding fallback query is empty.',
    };
  }

  const config = await readWorkspaceEmbeddingConfig(workspaceId);
  const autoLinkThreshold = Math.max(
    0.7,
    Math.min(1, Number(args.autoLinkThreshold || config.autoLinkThreshold || 0.93))
  );
  const marginThreshold = Math.max(
    0,
    Math.min(0.25, Number(args.marginThreshold || EMBEDDING_MARGIN_THRESHOLD))
  );

  if (!config.enabled) {
    return {
      status: 'unresolved',
      autoLinkThreshold,
      marginThreshold,
      candidates: [],
      reason: 'Embedding fallback disabled in workspace settings.',
    };
  }

  const search = await searchWorkspaceEmbeddings({
    workspaceId,
    query,
    corpora: [EmbeddingCorpus.GOVERNOR_IDENTITY],
    mode: config.retrievalMode,
    maxCandidates: Math.max(suggestionLimit * 3, config.maxCandidates),
    timeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
  });

  if (search.hits.length === 0) {
    return {
      status: 'unresolved',
      autoLinkThreshold,
      marginThreshold,
      candidates: [],
      reason: 'No semantic governor candidates found.',
    };
  }

  const bestByGovernor = new Map<string, EmbeddingSearchHit>();
  for (const hit of search.hits) {
    const existing = bestByGovernor.get(hit.entityId);
    if (!existing || hit.fusedScore > existing.fusedScore || hit.similarity > existing.similarity) {
      bestByGovernor.set(hit.entityId, hit);
    }
  }

  const governorIds = [...bestByGovernor.keys()];
  const governors = await prisma.governor.findMany({
    where: {
      workspaceId,
      id: {
        in: governorIds,
      },
    },
    select: {
      id: true,
      governorId: true,
      name: true,
    },
  });

  const governorById = new Map(governors.map((row) => [row.id, row]));
  const candidates = [...bestByGovernor.entries()]
    .map(([governorDbId, hit]) => {
      const governor = governorById.get(governorDbId);
      if (!governor) return null;
      const score = clamp01(Math.max(hit.similarity, hit.fusedScore * 60));
      return {
        governorDbId,
        governorGameId: governor.governorId,
        governorName: governor.name,
        score,
        documentId: hit.documentId,
      };
    })
    .filter((row): row is GovernorEmbeddingFallbackCandidate => Boolean(row))
    .sort((a, b) => b.score - a.score || a.governorName.localeCompare(b.governorName))
    .slice(0, suggestionLimit);

  if (candidates.length === 0) {
    return {
      status: 'unresolved',
      autoLinkThreshold,
      marginThreshold,
      candidates: [],
      reason: 'No governor candidates survived semantic filtering.',
    };
  }

  const top = candidates[0];
  const second = candidates[1] || null;
  const margin = second ? top.score - second.score : top.score;

  if (top.score >= autoLinkThreshold && margin >= marginThreshold) {
    return {
      status: 'resolved',
      autoLinkThreshold,
      marginThreshold,
      governor: top,
      candidates,
      reason: `Embedding fallback resolved a unique candidate (score ${top.score.toFixed(3)}).`,
    };
  }

  if (top.score >= autoLinkThreshold) {
    return {
      status: 'ambiguous',
      autoLinkThreshold,
      marginThreshold,
      candidates,
      reason: 'Embedding fallback produced multiple close high-confidence candidates.',
    };
  }

  return {
    status: 'unresolved',
    autoLinkThreshold,
    marginThreshold,
    candidates,
    reason: 'Embedding fallback did not reach auto-link threshold.',
  };
}
