import { NextRequest } from 'next/server';
import { WorkspaceRole } from '@prisma/client';
import { ok, fail, handleApiError, requireParam } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { getWeeklyActivityReport } from '@/lib/activity/service';
import { sendDiscordWebhookWithRetry } from '@/lib/discord';
import { prisma } from '@/lib/prisma';
import { formatMetric } from '@/features/shared/formatters';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = requireParam(body.workspaceId, 'workspaceId');
    const weekKey = requireParam(body.weekKey, 'weekKey');

    const auth = await authorizeWorkspaceAccess(request, workspaceId, WorkspaceRole.EDITOR);
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { discordWebhook: true, name: true },
    });

    if (!workspace?.discordWebhook) {
      return fail('VALIDATION_ERROR', 'Discord webhook is not configured for this workspace.', 400);
    }

    // 1) Load Activity Data
    const activity = await getWeeklyActivityReport({ workspaceId, weekKey });
    
    // Sort logic to find hall of fame & shame
    const kpLeaders = [...activity.rows].sort((a, b) => Number(b.killPointsGrowth) - Number(a.killPointsGrowth)).slice(0, 5);
    const deadsLeaders = [...activity.rows].sort((a, b) => Number(b.deadsGrowth) - Number(a.deadsGrowth)).slice(0, 3);
    
    const deadweight = activity.rows.filter(r => 
      r.compliance.overall === 'FAIL' && 
      Number(r.killPointsGrowth || 0) <= 0 && 
      Number(r.fortDestroying) <= 0
    );

    // 2) Build Discord Embed
    const embed = {
      title: `🏆 HamaROK Weekly Report: ${workspace.name}`,
      description: `Activity scan complete for week **${weekKey}**.\nTotal Tracked Players: **${activity.rows.length}**`,
      color: 0x00E5FF, // Teal brand
      fields: [
        {
          name: '⚔️ Top 5 Kill Points',
          value: kpLeaders.map((r, i) => `${i + 1}. **${r.governorName}** (+${formatMetric(r.killPointsGrowth)})`).join('\n') || 'None tracked.',
          inline: false
        },
        {
          name: '🛡️ The Anvil (Top Deads)',
          value: deadsLeaders.map((r, i) => `${i + 1}. **${r.governorName}** (${formatMetric(r.deadsGrowth)} Deads)`).join('\n') || 'No deads tracked.',
          inline: false
        },
        {
          name: '👻 Zero Activity (Purge Warning)',
          value: deadweight.length > 0 
                 ? deadweight.slice(0, 10).map(r => `• ${r.governorName} (ID: ${r.governorId})`).join('\n') + (deadweight.length > 10 ? `\n\n*...and ${deadweight.length - 10} more.*` : '')
                 : '✅ No deadweights detected this week! Incredible!',
          inline: false
        }
      ],
      footer: {
        text: 'HamaROK Automated Broadcast'
      },
      timestamp: new Date().toISOString()
    };

    // 3) Send to Discord
    const discordRes = await sendDiscordWebhookWithRetry(workspace.discordWebhook, {
      embeds: [embed]
    });

    if (!discordRes.success) {
      return fail('INTERNAL_ERROR', 'Failed to reach Discord.', 500);
    }

    return ok({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
