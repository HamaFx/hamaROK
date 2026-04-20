'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Settings2, Shield, Webhook } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';
import { parseAssistantConfigFromJson, serializeAssistantConfig } from '@/lib/assistant/config';

type AssistantAnalyzerMode = 'hybrid' | 'ocr_pipeline' | 'vision_model';
type AssistantContextMode = 'smart' | 'full' | 'prompt_only';
type AssistantSuggestionMode = 'signal' | 'always' | 'on_demand';
type AssistantInstructionPreset = 'conservative' | 'balanced' | 'aggressive';
type AssistantEmbeddingRetrievalMode = 'hybrid' | 'semantic' | 'lexical';

interface AssistantConfigState {
  screenshotAnalyzerDefault: AssistantAnalyzerMode;
  contextMode: AssistantContextMode;
  suggestionMode: AssistantSuggestionMode;
  instructionPreset: AssistantInstructionPreset;
  visionModel: string;
  batchEnabled: boolean;
  batchThreshold: number;
  readMaxToolsPerTurn: number;
  readMaxRowsPerTool: number;
  instructionGoal: string;
  instructionStyle: string;
  instructionDoRules: string;
  instructionDontRules: string;
  rawInstruction: string;
  embeddingEnabled: boolean;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingRetrievalMode: AssistantEmbeddingRetrievalMode;
  embeddingMaxCandidates: number;
  embeddingFallbackOnly: boolean;
  embeddingAutoLinkThreshold: number;
  embeddingBatchEnabled: boolean;
  embeddingBatchThreshold: number;
}

interface SettingsConfig {
  t4Weight: number;
  t5Weight: number;
  deadWeight: number;
  kpPerPowerRatio: number;
  deadPerPowerRatio: number;
  discordWebhook: string;
  ocrEngine: 'mistral' | 'legacy';
  ocrEngineEffective: 'mistral' | 'legacy';
  ocrEngineLocked: boolean;
  ocrEnginePolicyReason: 'workspace_override' | 'env_default' | 'legacy_blocked';
  accessRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  weekResetUtcOffset: string;
  assistantConfig: AssistantConfigState;
}

type AllianceTag = 'GODt' | 'V57' | 'P57R';

interface ActivityStandardState {
  allianceTag: AllianceTag;
  allianceLabel: string;
  contributionPoints: string;
  fortDestroying: string;
  powerGrowth: string;
  killPointsGrowth: string;
  isActive: boolean;
}

interface ActivityStandardApiRow {
  allianceTag: string;
  allianceLabel: string;
  metricKey: 'contribution_points' | 'power_growth' | 'fort_destroying' | 'kill_points_growth';
  minimumValue: string;
  isActive: boolean;
}

const ALLIANCES: Array<{ tag: AllianceTag; label: string }> = [
  { tag: 'GODt', label: '[GODt] GOD of Thunder' },
  { tag: 'V57', label: '[V57] Legacy of Velmora' },
  { tag: 'P57R', label: '[P57R] PHOENIX RISING 4057' },
];

const DEFAULTS: SettingsConfig = {
  t4Weight: 0.5,
  t5Weight: 1.0,
  deadWeight: 5.0,
  kpPerPowerRatio: 0.3,
  deadPerPowerRatio: 0.02,
  discordWebhook: '',
  ocrEngine: 'mistral',
  ocrEngineEffective: 'mistral',
  ocrEngineLocked: false,
  ocrEnginePolicyReason: 'env_default',
  accessRole: 'OWNER',
  weekResetUtcOffset: '+00:00',
  assistantConfig: {
    screenshotAnalyzerDefault: 'hybrid',
    contextMode: 'smart',
    suggestionMode: 'signal',
    instructionPreset: 'balanced',
    visionModel: 'mistral-large-latest',
    batchEnabled: true,
    batchThreshold: 80,
    readMaxToolsPerTurn: 12,
    readMaxRowsPerTool: 60,
    instructionGoal: '',
    instructionStyle: '',
    instructionDoRules: '',
    instructionDontRules: '',
    rawInstruction: '',
    embeddingEnabled: true,
    embeddingModel: 'mistral-embed-2312',
    embeddingDimension: 1024,
    embeddingRetrievalMode: 'hybrid',
    embeddingMaxCandidates: 24,
    embeddingFallbackOnly: true,
    embeddingAutoLinkThreshold: 0.93,
    embeddingBatchEnabled: true,
    embeddingBatchThreshold: 80,
  },
};

function defaultStandards(): ActivityStandardState[] {
  return ALLIANCES.map((alliance) => ({
    allianceTag: alliance.tag,
    allianceLabel: alliance.label,
    contributionPoints: '0',
    fortDestroying: '0',
    powerGrowth: '0',
    killPointsGrowth: '0',
    isActive: true,
  }));
}

function normalizeIntegerInput(value: string): string {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '0';
  return digits.replace(/^0+(?=\d)/, '');
}

function formatInt(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value;
}

function toRuleText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) =>
      String(entry || '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

function parseRuleText(value: string): string[] {
  return String(value || '')
    .split('\n')
    .map((entry) =>
      entry
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 20);
}

export default function SettingsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [config, setConfig] = useState<SettingsConfig>(DEFAULTS);
  const [standards, setStandards] = useState<ActivityStandardState[]>(defaultStandards());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!workspaceReady) {
      setLoading(sessionLoading);
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setMessage(null);

        const [settingsRes, standardsRes] = await Promise.all([
          fetch(`/api/v2/workspaces/${workspaceId}/settings`, {
            headers: {
              'x-access-token': accessToken,
            },
          }),
          fetch(`/api/v2/activity/standards?workspaceId=${encodeURIComponent(workspaceId)}`, {
            headers: {
              'x-access-token': accessToken,
            },
          }),
        ]);

        const settingsPayload = await settingsRes.json();
        if (!settingsRes.ok || !settingsPayload?.data) {
          throw new Error(settingsPayload?.error?.message || 'Failed to load settings from API.');
        }

        const settingsData = settingsPayload.data as Partial<SettingsConfig> & {
          assistantConfig?: unknown;
        };
        const assistantConfig = parseAssistantConfigFromJson(settingsData.assistantConfig);
        setConfig({
          t4Weight: settingsData.t4Weight ?? DEFAULTS.t4Weight,
          t5Weight: settingsData.t5Weight ?? DEFAULTS.t5Weight,
          deadWeight: settingsData.deadWeight ?? DEFAULTS.deadWeight,
          kpPerPowerRatio: settingsData.kpPerPowerRatio ?? DEFAULTS.kpPerPowerRatio,
          deadPerPowerRatio: settingsData.deadPerPowerRatio ?? DEFAULTS.deadPerPowerRatio,
          discordWebhook: settingsData.discordWebhook ?? DEFAULTS.discordWebhook,
          ocrEngine:
            settingsData.ocrEngine === 'legacy'
              ? 'legacy'
              : 'mistral',
          ocrEngineEffective:
            settingsData.ocrEngineEffective === 'legacy'
              ? 'legacy'
              : 'mistral',
          ocrEngineLocked: Boolean(settingsData.ocrEngineLocked),
          ocrEnginePolicyReason:
            settingsData.ocrEnginePolicyReason === 'workspace_override' ||
            settingsData.ocrEnginePolicyReason === 'legacy_blocked'
              ? settingsData.ocrEnginePolicyReason
              : 'env_default',
          accessRole:
            settingsData.accessRole === 'VIEWER' || settingsData.accessRole === 'EDITOR'
              ? settingsData.accessRole
              : 'OWNER',
          weekResetUtcOffset:
            typeof settingsData.weekResetUtcOffset === 'string'
              ? settingsData.weekResetUtcOffset
              : DEFAULTS.weekResetUtcOffset,
          assistantConfig: {
            screenshotAnalyzerDefault: assistantConfig.screenshotAnalyzerDefault,
            contextMode: assistantConfig.contextMode,
            suggestionMode: assistantConfig.suggestionMode,
            instructionPreset: assistantConfig.instructionPreset,
            visionModel: assistantConfig.visionModel,
            batchEnabled: assistantConfig.batch.enabled,
            batchThreshold: assistantConfig.batch.threshold,
            readMaxToolsPerTurn: assistantConfig.readLimits.maxToolsPerTurn,
            readMaxRowsPerTool: assistantConfig.readLimits.maxRowsPerTool,
            instructionGoal: assistantConfig.instructionProfile.goal,
            instructionStyle: assistantConfig.instructionProfile.style,
            instructionDoRules: toRuleText(assistantConfig.instructionProfile.doRules),
            instructionDontRules: toRuleText(assistantConfig.instructionProfile.dontRules),
            rawInstruction: assistantConfig.rawInstruction,
            embeddingEnabled: assistantConfig.embedding.enabled,
            embeddingModel: assistantConfig.embedding.model,
            embeddingDimension: assistantConfig.embedding.dimension,
            embeddingRetrievalMode: assistantConfig.embedding.retrievalMode,
            embeddingMaxCandidates: assistantConfig.embedding.maxCandidates,
            embeddingFallbackOnly: assistantConfig.embedding.fallbackOnly,
            embeddingAutoLinkThreshold: assistantConfig.embedding.autoLinkThreshold,
            embeddingBatchEnabled: assistantConfig.embedding.batch.enabled,
            embeddingBatchThreshold: assistantConfig.embedding.batch.threshold,
          },
        });

        if (standardsRes.ok) {
          const standardsPayload = await standardsRes.json();
          const rows = (Array.isArray(standardsPayload?.data)
            ? standardsPayload.data
            : []) as ActivityStandardApiRow[];

          const merged = defaultStandards();
          for (const row of rows) {
            const idx = merged.findIndex((item) => item.allianceTag === row.allianceTag);
            if (idx < 0) continue;
            if (row.metricKey === 'contribution_points') {
              merged[idx].contributionPoints = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'fort_destroying') {
              merged[idx].fortDestroying = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'power_growth') {
              merged[idx].powerGrowth = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            if (row.metricKey === 'kill_points_growth') {
              merged[idx].killPointsGrowth = normalizeIntegerInput(String(row.minimumValue || '0'));
            }
            merged[idx].isActive = row.isActive ?? true;
            if (row.allianceLabel) {
              merged[idx].allianceLabel = row.allianceLabel;
            }
          }
          setStandards(merged);
        } else {
          setStandards(defaultStandards());
        }
      } catch (cause) {
        setMessage({
          type: 'error',
          text: cause instanceof Error ? cause.message : 'Failed to load settings from API.',
        });
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [workspaceId, accessToken, workspaceReady, sessionLoading]);

  const saveAll = async () => {
    if (!workspaceReady) {
      setMessage({
        type: 'error',
        text: sessionLoading ? 'Connecting workspace session...' : sessionError || 'Workspace session is not ready.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const standardsPayload = standards.flatMap((row) => [
        {
          allianceTag: row.allianceTag,
          metricKey: 'contribution_points',
          minimumValue: normalizeIntegerInput(row.contributionPoints),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'fort_destroying',
          minimumValue: normalizeIntegerInput(row.fortDestroying),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'power_growth',
          minimumValue: normalizeIntegerInput(row.powerGrowth),
          isActive: row.isActive,
        },
        {
          allianceTag: row.allianceTag,
          metricKey: 'kill_points_growth',
          minimumValue: normalizeIntegerInput(row.killPointsGrowth),
          isActive: row.isActive,
        },
      ]);

      const assistantConfigPayload = serializeAssistantConfig({
        screenshotAnalyzerDefault: config.assistantConfig.screenshotAnalyzerDefault,
        contextMode: config.assistantConfig.contextMode,
        suggestionMode: config.assistantConfig.suggestionMode,
        instructionPreset: config.assistantConfig.instructionPreset,
        visionModel: config.assistantConfig.visionModel,
        batch: {
          enabled: config.assistantConfig.batchEnabled,
          threshold: Number(config.assistantConfig.batchThreshold) || 80,
        },
        readLimits: {
          maxToolsPerTurn: Number(config.assistantConfig.readMaxToolsPerTurn) || 12,
          maxRowsPerTool: Number(config.assistantConfig.readMaxRowsPerTool) || 60,
        },
        instructionProfile: {
          goal: config.assistantConfig.instructionGoal,
          style: config.assistantConfig.instructionStyle,
          doRules: parseRuleText(config.assistantConfig.instructionDoRules),
          dontRules: parseRuleText(config.assistantConfig.instructionDontRules),
        },
        rawInstruction: config.assistantConfig.rawInstruction,
        embedding: {
          enabled: config.assistantConfig.embeddingEnabled,
          model: config.assistantConfig.embeddingModel,
          dimension: Math.max(64, Math.min(4096, Number(config.assistantConfig.embeddingDimension) || 1024)),
          retrievalMode: config.assistantConfig.embeddingRetrievalMode,
          maxCandidates: Math.max(
            1,
            Math.min(200, Number(config.assistantConfig.embeddingMaxCandidates) || 24)
          ),
          fallbackOnly: config.assistantConfig.embeddingFallbackOnly,
          autoLinkThreshold: Math.max(
            0.7,
            Math.min(1, Number(config.assistantConfig.embeddingAutoLinkThreshold) || 0.93)
          ),
          batch: {
            enabled: config.assistantConfig.embeddingBatchEnabled,
            threshold: Math.max(
              20,
              Math.min(100000, Number(config.assistantConfig.embeddingBatchThreshold) || 80)
            ),
          },
        },
      });

      const settingsBody: Record<string, unknown> = {
        t4Weight: config.t4Weight,
        t5Weight: config.t5Weight,
        deadWeight: config.deadWeight,
        kpPerPowerRatio: config.kpPerPowerRatio,
        deadPerPowerRatio: config.deadPerPowerRatio,
        discordWebhook: config.discordWebhook,
        weekResetUtcOffset: config.weekResetUtcOffset,
        assistantConfig: assistantConfigPayload,
      };
      if (config.accessRole === 'OWNER') {
        settingsBody.ocrEngine = config.ocrEngine;
      }

      const [settingsRes, standardsRes] = await Promise.all([
        fetch(`/api/v2/workspaces/${workspaceId}/settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify(settingsBody),
        }),
        fetch('/api/v2/activity/standards', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            standards: standardsPayload,
          }),
        }),
      ]);

      const settingsResult = await settingsRes.json();
      const standardsResult = await standardsRes.json();

      if (!settingsRes.ok) {
        throw new Error(settingsResult?.error?.message || 'Failed to save combat settings.');
      }
      if (!standardsRes.ok) {
        throw new Error(standardsResult?.error?.message || 'Failed to save weekly standards.');
      }

      setMessage({ type: 'success', text: 'Settings and weekly standards saved.' });
    } catch (cause) {
      setMessage({
        type: 'error',
        text: cause instanceof Error ? cause.message : 'Failed to save settings.',
      });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]:
        name === 'discordWebhook' || name === 'weekResetUtcOffset'
          ? value
          : Number(value),
    }));
  };

  const handleAssistantConfigChange = <K extends keyof AssistantConfigState>(
    key: K,
    value: AssistantConfigState[K]
  ) => {
    setConfig((prev) => ({
      ...prev,
      assistantConfig: {
        ...prev.assistantConfig,
        [key]: value,
      },
    }));
  };

  const handleStandardChange = (
    allianceTag: AllianceTag,
    key: 'contributionPoints' | 'fortDestroying' | 'powerGrowth' | 'killPointsGrowth',
    value: string
  ) => {
    setStandards((prev) =>
      prev.map((row) =>
        row.allianceTag === allianceTag
          ? {
              ...row,
              [key]: normalizeIntegerInput(value),
            }
          : row
      )
    );
  };

  const formulaPreview = useMemo(() => {
    const killWeight = config.t4Weight + config.t5Weight;
    const engagementWeight = config.deadWeight + config.kpPerPowerRatio * 10 + config.deadPerPowerRatio * 100;
    return {
      killWeight: Math.round(killWeight * 100) / 100,
      engagementWeight: Math.round(engagementWeight * 100) / 100,
    };
  }, [config]);

  const weeklySummary = useMemo(() => {
    const members = standards.filter((row) => row.isActive).length;
    const totalContribution = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.contributionPoints)),
      BigInt(0)
    );
    const totalFort = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.fortDestroying)),
      BigInt(0)
    );
    const totalGrowth = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.powerGrowth)),
      BigInt(0)
    );
    const totalKpGrowth = standards.reduce(
      (sum, row) => sum + BigInt(normalizeIntegerInput(row.killPointsGrowth)),
      BigInt(0)
    );

    return {
      trackedAlliances: members,
      totalContribution: totalContribution.toString(),
      totalFort: totalFort.toString(),
      totalGrowth: totalGrowth.toString(),
      totalKpGrowth: totalKpGrowth.toString(),
    };
  }, [standards]);

  const assistantInstructionPreview = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Preset: ${config.assistantConfig.instructionPreset}`);
    if (config.assistantConfig.instructionGoal.trim()) {
      lines.push(`Goal: ${config.assistantConfig.instructionGoal.trim()}`);
    }
    if (config.assistantConfig.instructionStyle.trim()) {
      lines.push(`Style: ${config.assistantConfig.instructionStyle.trim()}`);
    }
    const doRules = parseRuleText(config.assistantConfig.instructionDoRules);
    if (doRules.length > 0) {
      lines.push(`Do:\n${doRules.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`);
    }
    const dontRules = parseRuleText(config.assistantConfig.instructionDontRules);
    if (dontRules.length > 0) {
      lines.push(`Do-not:\n${dontRules.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}`);
    }
    if (config.assistantConfig.rawInstruction.trim()) {
      lines.push(`Raw instruction:\n${config.assistantConfig.rawInstruction.trim()}`);
    }
    lines.push(
      `Embeddings: ${config.assistantConfig.embeddingEnabled ? 'enabled' : 'disabled'} | ${config.assistantConfig.embeddingModel} | ${config.assistantConfig.embeddingRetrievalMode}`
    );
    return lines.join('\n\n');
  }, [config.assistantConfig]);

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Settings"
        subtitle="Configure combat scoring, weekly standards, and Discord delivery."
        actions={
          <Button
            className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
            onClick={saveAll}
            disabled={saving || loading}
          >
            <Save data-icon="inline-start" />
            {saving ? 'Saving...' : 'Save All'}
          </Button>
        }
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {message && message.type === 'error' ? <InlineError message={message.text} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <KpiCard label="T4 Weight" value={config.t4Weight} hint="Kill score multiplier" tone="info" />
          <KpiCard label="T5 Weight" value={config.t5Weight} hint="Kill score multiplier" tone="warn" />
          <KpiCard label="Dead Weight" value={config.deadWeight} hint="Commitment multiplier" tone="good" />
          <KpiCard label="Formula Mix" value={formulaPreview.killWeight} hint="Combined kill weighting" tone="neutral" />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Combat Formula"
            subtitle="Scoring multipliers used across weekly activity scoring and rankings."
            actions={
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    t4Weight: DEFAULTS.t4Weight,
                    t5Weight: DEFAULTS.t5Weight,
                    deadWeight: DEFAULTS.deadWeight,
                    kpPerPowerRatio: DEFAULTS.kpPerPowerRatio,
                    deadPerPowerRatio: DEFAULTS.deadPerPowerRatio,
                  }))
                }
              >
                Reset Formula
              </Button>
            }
          >
            <div className="space-y-5">
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>T4 Kill Weight</span>
                  <span>{config.t4Weight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="t4Weight"
                  min="0"
                  max="5"
                  step="0.1"
                  value={config.t4Weight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>T5 Kill Weight</span>
                  <span>{config.t5Weight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="t5Weight"
                  min="0"
                  max="10"
                  step="0.5"
                  value={config.t5Weight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Dead Troops Weight</span>
                  <span>{config.deadWeight} DKP</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="deadWeight"
                  min="0"
                  max="25"
                  step="1"
                  value={config.deadWeight}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Expected KP per 1M power</span>
                  <span>{(config.kpPerPowerRatio * 1000).toLocaleString()}k</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="kpPerPowerRatio"
                  min="0"
                  max="2"
                  step="0.05"
                  value={config.kpPerPowerRatio}
                  onChange={handleConfigChange}
                />
              </div>
              <div className="space-y-2.5">
                <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                  <span>Expected Deads per 1M power</span>
                  <span>{(config.deadPerPowerRatio * 1000).toLocaleString()}k</span>
                </label>
                <input
                  className="h-2 w-full accent-sky-300"
                  type="range"
                  name="deadPerPowerRatio"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={config.deadPerPowerRatio}
                  onChange={handleConfigChange}
                />
              </div>
            </div>

            <FilterBar className="mt-4">
              <Settings2 className="size-4" />
              <span className="text-sm text-tier-2">Engagement mix score: {formulaPreview.engagementWeight}</span>
            </FilterBar>
          </Panel>

          <Panel
            title="Weekly Activity Standards"
            subtitle="Minimum thresholds reset weekly using the configured game reset offset."
          >
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 text-xs  text-tier-3">
                <span>Week Reset UTC Offset</span>
                <span>{config.weekResetUtcOffset}</span>
              </label>
              <Input
                type="text"
                name="weekResetUtcOffset"
                value={config.weekResetUtcOffset}
                onChange={handleConfigChange}
                placeholder="+00:00"
                pattern="^[+-](0\\d|1[0-4]):[0-5]\\d$"
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
              />
              <p className="text-xs text-tier-3">Format `+HH:MM` or `-HH:MM` (example `+03:00`).</p>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {standards.map((row) => (
                <div
                  key={row.allianceTag}
                  className="rounded-[22px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5"
                >
                  <p className="font-heading text-sm text-tier-1">{row.allianceLabel}</p>
                  <div className="mt-3 grid gap-2.5 grid-cols-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.contributionPoints}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'contributionPoints', e.target.value)}
                      aria-label={`${row.allianceLabel} contribution minimum`}
                      placeholder="Contribution"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.fortDestroying}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'fortDestroying', e.target.value)}
                      aria-label={`${row.allianceLabel} fort destroying minimum`}
                      placeholder="Fort"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.powerGrowth}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'powerGrowth', e.target.value)}
                      aria-label={`${row.allianceLabel} power growth minimum`}
                      placeholder="Power"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={row.killPointsGrowth}
                      onChange={(e) => handleStandardChange(row.allianceTag, 'killPointsGrowth', e.target.value)}
                      aria-label={`${row.allianceLabel} kill points growth minimum`}
                      placeholder="KP"
                      className="rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 hidden overflow-hidden rounded-[22px] border border-[color:var(--stroke-soft)] md:block">
              <table className="w-full border-collapse text-sm text-tier-2">
                <thead className="bg-[color:var(--surface-3)] text-xs  text-tier-3">
                  <tr>
                    <th className="px-3 py-2 text-left">Alliance</th>
                    <th className="px-3 py-2 text-left">Contribution Min</th>
                    <th className="px-3 py-2 text-left">Fort Destroy Min</th>
                    <th className="px-3 py-2 text-left">Power Growth Min</th>
                    <th className="px-3 py-2 text-left">KP Growth Min</th>
                  </tr>
                </thead>
                <tbody>
                  {standards.map((row) => (
                    <tr key={row.allianceTag} className="border-t border-[color:var(--stroke-subtle)]">
                      <td className="px-3 py-2.5 font-medium text-tier-1">{row.allianceLabel}</td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.contributionPoints}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'contributionPoints', e.target.value)}
                          aria-label={`${row.allianceLabel} contribution minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.fortDestroying}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'fortDestroying', e.target.value)}
                          aria-label={`${row.allianceLabel} fort destroying minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.powerGrowth}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'powerGrowth', e.target.value)}
                          aria-label={`${row.allianceLabel} power growth minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={row.killPointsGrowth}
                          onChange={(e) => handleStandardChange(row.allianceTag, 'killPointsGrowth', e.target.value)}
                          aria-label={`${row.allianceLabel} kill points growth minimum`}
                          className="h-11 rounded-xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <FilterBar className="mt-4">
              <Shield className="size-4" />
              <span className="text-sm text-tier-2">
                Totals: Contribution {formatInt(weeklySummary.totalContribution)} • Fort {formatInt(weeklySummary.totalFort)} • Power Growth {formatInt(weeklySummary.totalGrowth)} • KP Growth {formatInt(weeklySummary.totalKpGrowth)}
              </span>
            </FilterBar>
          </Panel>
        </div>

        <Panel title="Discord Integration">
          <div className="space-y-2">
            <label className="text-xs  text-tier-3">Webhook URL</label>
            <Input
              type="text"
              name="discordWebhook"
              value={config.discordWebhook}
              onChange={handleConfigChange}
              placeholder="https://discord.com/api/webhooks/..."
              className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
            />
          </div>
          <FilterBar className="mt-4">
            <Webhook className="size-4" />
            <span className="text-sm text-tier-2">Used by Discord publish endpoints and delivery retries.</span>
          </FilterBar>
        </Panel>

        <Panel
          title="AI Assistant"
          subtitle="Tune analyzer strategy, context behavior, and custom instructions."
        >
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">OCR Engine</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1 disabled:opacity-60"
                value={config.ocrEngine}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    ocrEngine: event.target.value === 'legacy' ? 'legacy' : 'mistral',
                  }))
                }
                disabled={config.accessRole !== 'OWNER'}
              >
                <option value="mistral">Mistral (default)</option>
                <option value="legacy">Legacy OCR (emergency fallback)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Effective OCR Engine</label>
              <div className="h-11 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1 flex items-center justify-between">
                <span className="font-medium">{config.ocrEngineEffective}</span>
                <StatusPill
                  label={config.ocrEngineLocked ? 'Locked' : config.ocrEnginePolicyReason === 'workspace_override' ? 'Workspace Override' : 'Default'}
                  tone={config.ocrEngineEffective === 'legacy' ? 'warn' : 'info'}
                />
              </div>
            </div>
          </div>
          <p className="mb-5 text-xs text-tier-3">
            {config.accessRole !== 'OWNER'
              ? 'Only OWNER can change OCR engine. Your role can still edit other AI settings.'
              : config.ocrEngineLocked
                ? 'Legacy OCR is requested but blocked until ALLOW_LEGACY_OCR=true in environment.'
                : 'Mistral remains the primary OCR path. Legacy is for emergency rollback only.'}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Screenshot Analyzer Default</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.screenshotAnalyzerDefault}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'screenshotAnalyzerDefault',
                    event.target.value as AssistantAnalyzerMode
                  )
                }
              >
                <option value="hybrid">Hybrid (OCR + Vision fallback)</option>
                <option value="ocr_pipeline">Mistral OCR</option>
                <option value="vision_model">Mistral Large Vision</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Context Mode</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.contextMode}
                onChange={(event) =>
                  handleAssistantConfigChange('contextMode', event.target.value as AssistantContextMode)
                }
              >
                <option value="smart">Smart Context Pack</option>
                <option value="full">Full Context</option>
                <option value="prompt_only">Prompt Only</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Suggestion Mode</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.suggestionMode}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'suggestionMode',
                    event.target.value as AssistantSuggestionMode
                  )
                }
              >
                <option value="signal">Signal-Based</option>
                <option value="always">Always</option>
                <option value="on_demand">On Demand</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Instruction Preset</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.instructionPreset}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'instructionPreset',
                    event.target.value as AssistantInstructionPreset
                  )
                }
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Mistral Large Vision Model</label>
              <Input
                value={config.assistantConfig.visionModel}
                onChange={(event) => handleAssistantConfigChange('visionModel', event.target.value)}
                placeholder="mistral-large-latest"
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embeddings</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.embeddingEnabled ? 'enabled' : 'disabled'}
                onChange={(event) =>
                  handleAssistantConfigChange('embeddingEnabled', event.target.value === 'enabled')
                }
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Model</label>
              <Input
                value={config.assistantConfig.embeddingModel}
                onChange={(event) => handleAssistantConfigChange('embeddingModel', event.target.value)}
                placeholder="mistral-embed-2312"
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Retrieval Mode</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.embeddingRetrievalMode}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'embeddingRetrievalMode',
                    event.target.value as AssistantEmbeddingRetrievalMode
                  )
                }
              >
                <option value="hybrid">Hybrid (vector + lexical)</option>
                <option value="semantic">Semantic only</option>
                <option value="lexical">Lexical only</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Dimension</label>
              <Input
                type="number"
                min={64}
                max={4096}
                value={config.assistantConfig.embeddingDimension}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'embeddingDimension',
                    Math.max(64, Math.min(4096, Number(event.target.value || 1024)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Max Candidates</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={config.assistantConfig.embeddingMaxCandidates}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'embeddingMaxCandidates',
                    Math.max(1, Math.min(200, Number(event.target.value || 24)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Fallback Only</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.embeddingFallbackOnly ? 'true' : 'false'}
                onChange={(event) =>
                  handleAssistantConfigChange('embeddingFallbackOnly', event.target.value === 'true')
                }
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Auto-link Threshold</label>
              <Input
                type="number"
                min={0.7}
                max={1}
                step={0.01}
                value={config.assistantConfig.embeddingAutoLinkThreshold}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'embeddingAutoLinkThreshold',
                    Math.max(0.7, Math.min(1, Number(event.target.value || 0.93)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Batch Enabled</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.embeddingBatchEnabled ? 'enabled' : 'disabled'}
                onChange={(event) =>
                  handleAssistantConfigChange('embeddingBatchEnabled', event.target.value === 'enabled')
                }
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Embedding Batch Threshold</label>
              <Input
                type="number"
                min={20}
                max={100000}
                value={config.assistantConfig.embeddingBatchThreshold}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'embeddingBatchThreshold',
                    Math.max(20, Math.min(100000, Number(event.target.value || 80)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Batch Extraction Enabled</label>
              <select
                className="h-11 w-full rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 text-sm text-tier-1"
                value={config.assistantConfig.batchEnabled ? 'enabled' : 'disabled'}
                onChange={(event) =>
                  handleAssistantConfigChange('batchEnabled', event.target.value === 'enabled')
                }
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Batch Threshold</label>
              <Input
                type="number"
                min={20}
                max={5000}
                value={config.assistantConfig.batchThreshold}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'batchThreshold',
                    Math.max(20, Math.min(5000, Number(event.target.value || 80)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Max Read Tools / Turn</label>
              <Input
                type="number"
                min={1}
                max={30}
                value={config.assistantConfig.readMaxToolsPerTurn}
                onChange={(event) =>
                  handleAssistantConfigChange(
                    'readMaxToolsPerTurn',
                    Math.max(1, Math.min(30, Number(event.target.value || 12)))
                  )
                }
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-xs text-tier-3">Max Rows / Read Tool</label>
            <Input
              type="number"
              min={1}
              max={200}
              value={config.assistantConfig.readMaxRowsPerTool}
              onChange={(event) =>
                handleAssistantConfigChange(
                  'readMaxRowsPerTool',
                  Math.max(1, Math.min(200, Number(event.target.value || 60)))
                )
              }
              className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
            />
          </div>

          <div className="mt-5 grid gap-4">
            <div className="space-y-2">
              <label className="text-xs text-tier-3">Instruction Goal</label>
              <Input
                value={config.assistantConfig.instructionGoal}
                onChange={(event) => handleAssistantConfigChange('instructionGoal', event.target.value)}
                placeholder="e.g. Maintain clean player identity linking and conservative writes."
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Instruction Style</label>
              <Input
                value={config.assistantConfig.instructionStyle}
                onChange={(event) => handleAssistantConfigChange('instructionStyle', event.target.value)}
                placeholder="e.g. concise, evidence-first, explicit assumptions."
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Do Rules (one per line)</label>
              <Textarea
                rows={4}
                value={config.assistantConfig.instructionDoRules}
                onChange={(event) => handleAssistantConfigChange('instructionDoRules', event.target.value)}
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Do-not Rules (one per line)</label>
              <Textarea
                rows={4}
                value={config.assistantConfig.instructionDontRules}
                onChange={(event) => handleAssistantConfigChange('instructionDontRules', event.target.value)}
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-tier-3">Raw Instruction</label>
              <Textarea
                rows={5}
                value={config.assistantConfig.rawInstruction}
                onChange={(event) => handleAssistantConfigChange('rawInstruction', event.target.value)}
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1"
              />
            </div>
          </div>

          <FilterBar className="mt-4">
            <StatusPill label="Preview" tone="info" />
            <span className="text-sm text-tier-2 whitespace-pre-wrap">
              {assistantInstructionPreview || 'No custom instruction configured.'}
            </span>
          </FilterBar>
        </Panel>

        {message && message.type === 'success' ? (
          <FilterBar className="rounded-2xl border-emerald-300/16 bg-emerald-400/10 px-4 py-3 text-emerald-100">
            <StatusPill label="Saved" tone="good" />
            <span className="text-sm">{message.text}</span>
          </FilterBar>
        ) : null}
      </SessionGate>
    </div>
  );
}
