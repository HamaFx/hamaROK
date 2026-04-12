import { NextRequest } from 'next/server';
import { DeliveryStatus, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, handleApiError, readJson } from '@/lib/api-response';
import { authorizeWorkspaceAccess } from '@/lib/workspace-auth';
import { compareWorkspaceEvents } from '@/lib/compare-service';
import { getTierConfig } from '@/lib/warrior-score';
import { hashDestination } from '@/lib/security';
import { sendDiscordWebhookWithRetry } from '@/lib/discord';
import { withIdempotency } from '@/lib/idempotency';

const publishSchema = z.object({
  workspaceId: z.string().min(1),
  eventA: z.string().min(1),
  eventB: z.string().min(1),
  topN: z.number().int().min(3).max(50).default(10),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

function nextRetryDelayMs(attemptCount: number) {
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attemptCount - 1)));
  return minutes * 60 * 1000;
}

export async function POST(request: NextRequest) {
  try {
    const body = publishSchema.parse(await readJson(request));
    const auth = await authorizeWorkspaceAccess(
      request,
      body.workspaceId,
      WorkspaceRole.EDITOR
    );
    if (!auth.ok) {
      return fail(auth.code, auth.message, auth.code === 'UNAUTHORIZED' ? 401 : 403);
    }

    const settings = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: body.workspaceId },
    });

    if (!settings?.discordWebhook) {
      return fail(
        'VALIDATION_ERROR',
        'Discord webhook is not configured for this workspace.',
        400
      );
    }
    const webhookUrl = settings.discordWebhook;

    const idempotent = await withIdempotency({
      workspaceId: body.workspaceId,
      scope: 'discord-publish',
      key: body.idempotencyKey,
      request: {
        eventA: body.eventA,
        eventB: body.eventB,
        topN: body.topN,
      },
      ttlHours: 8,
      execute: async () => {
        const result = await compareWorkspaceEvents({
          workspaceId: body.workspaceId,
          eventAId: body.eventA,
          eventBId: body.eventB,
        });

        const leaderboard = result.comparisons
          .filter((row) => row.warriorScore)
          .slice(0, body.topN);

        const bestKp = result.summary.topByKillPoints?.slice(0, 5) || [];
        const embed = {
          title: `KvK Combat Analytics: ${result.eventA.name} -> ${result.eventB.name}`,
          description: `Compared governors: ${result.summary.totalGovernors}\nAverage score: ${result.summary.avgWarriorScore}%\nAnomalies: ${result.summary.anomalyCount}`,
          color: 16766720,
          fields: [
            {
              name: `Top ${body.topN} Leaderboard`,
              value:
                leaderboard
                  .map((entry) => {
                    const ws = entry.warriorScore!;
                    const tier = getTierConfig(ws.tier);
                    return `**${ws.rank}.** ${tier.emoji} **${entry.governor.name}** - ${ws.totalScore}% (Act ${ws.actualDkp.toLocaleString()} / Exp ${(ws.expectedDkp ?? ws.expectedKp).toLocaleString()})`;
                  })
                  .join('\n') || 'No data.',
            },
            {
              name: 'Top Kill Point Delta',
              value:
                bestKp
                  .map(
                    (entry, index) =>
                      `**${index + 1}.** ${entry.governorName}: ${entry.killPointsDelta.toLocaleString()} KP`
                  )
                  .join('\n') || 'No data.',
            },
            {
              name: 'Deadweight Watchlist',
              value:
                leaderboard
                  .filter((entry) => entry.warriorScore?.isDeadweight)
                  .map(
                    (entry) =>
                      `⚠️ ${entry.governor.name} (${entry.warriorScore?.actualDkp.toLocaleString()} DKP | ${entry.deltas.power} power Δ)`
                  )
                  .join('\n') || 'None.',
            },
          ],
          footer: { text: 'RoK Command Center v2' },
          timestamp: new Date().toISOString(),
        };

        const webhookBody = {
          username: 'RoK Command Center',
          avatar_url: 'https://cdn-icons-png.flaticon.com/512/2855/2855663.png',
          embeds: [embed],
        };

        const delivery = await prisma.deliveryLog.create({
          data: {
            workspaceId: body.workspaceId,
            integration: 'discord',
            destinationHash: hashDestination(webhookUrl),
            payload: {
              eventA: body.eventA,
              eventB: body.eventB,
              topN: body.topN,
              governorCount: result.summary.totalGovernors,
              webhookBody,
            },
          },
        });

        const sendResult = await sendDiscordWebhookWithRetry(webhookUrl, webhookBody, {
          maxAttempts: 4,
          baseDelayMs: 800,
        });

        const updatedDelivery = await prisma.deliveryLog.update({
          where: { id: delivery.id },
          data: {
            status: sendResult.success ? DeliveryStatus.SENT : DeliveryStatus.RETRYING,
            attemptCount: sendResult.attempts,
            lastError: sendResult.success ? null : sendResult.error,
            nextAttemptAt: sendResult.success
              ? null
              : new Date(Date.now() + nextRetryDelayMs(sendResult.attempts)),
          },
        });

        return {
          deliveryLogId: updatedDelivery.id,
          attemptCount: updatedDelivery.attemptCount,
          status: updatedDelivery.status,
          rateLimitedCount: sendResult.rateLimitedCount,
          summary: result.summary,
        };
      },
    });

    if (
      idempotent.value.status === DeliveryStatus.RETRYING ||
      idempotent.value.status === DeliveryStatus.FAILED
    ) {
      return fail(
        'INTERNAL_ERROR',
        'Discord publish queued for retry.',
        502,
        {
          deliveryLogId: idempotent.value.deliveryLogId,
          attemptCount: idempotent.value.attemptCount,
          replayed: idempotent.replayed,
        }
      );
    }

    return ok(
      {
        ...idempotent.value,
        replayed: idempotent.replayed,
      },
      idempotent.replayed ? { idempotentReplay: true } : null,
      idempotent.replayed ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
