import { countPendingMetricSyncBacklog, getMetricSourceCoverage } from '@/lib/metric-sync';
import { getWeeklyActivityReport } from '@/lib/activity/service';

export async function getWorkspaceStatsOverview(args: {
  workspaceId: string;
  weekKey?: string | null;
}) {
  const report = await getWeeklyActivityReport({
    workspaceId: args.workspaceId,
    weekKey: args.weekKey || null,
  });

  const [pendingSyncCount, sourceCoverage] = await Promise.all([
    countPendingMetricSyncBacklog({ workspaceId: args.workspaceId }),
    getMetricSourceCoverage({ workspaceId: args.workspaceId, eventId: report.event.id }),
  ]);

  return {
    event: report.event,
    previousEvent: report.previousEvent,
    pendingSyncCount,
    sourceCoverage,
    summary: report.summary,
    topPerformers: {
      contribution: report.summary.topContribution,
      powerGrowth: report.summary.topPowerGrowth,
      fortDestroying: report.summary.topFortDestroying,
      killPointsGrowth: report.summary.topKillPointsGrowth,
    },
  };
}
