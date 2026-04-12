import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTierConfig } from '@/lib/warrior-score';

export async function POST(request: NextRequest) {
  try {
    const { eventA, eventB, leaderboard, summary } = await request.json();

    const settings = await prisma.kingdomSettings.findUnique({ where: { id: 'default' } });
    const webhookUrl = settings?.discordWebhook;

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Discord webhook URL is not configured.' }, { status: 400 });
    }

    // Format Discord Embed
    const embed = {
      title: `🏆 KvK Combat Analytics: ${eventA.name} ➡️ ${eventB.name}`,
      description: `**Total Governors Evaluated:** ${summary.totalGovernors}\n**Average DKP Score:** ${summary.avgWarriorScore}%`,
      color: 16766720, // Gold color
      fields: [
        {
          name: '🎖️ Top 10 Honors',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value: leaderboard.slice(0, 10).map((p: any) => {
            const config = getTierConfig(p.warriorScore.tier);
            return `**${p.warriorScore.rank}.** ${config.emoji} **${p.governor.name}**\n↳ Score: **${p.warriorScore.totalScore}%** [Act: **${p.warriorScore.actualDkp.toLocaleString()}** / Exp: **${p.warriorScore.expectedKp.toLocaleString()}**]`;
          }).join('\n\n') || '*No records found.*'
        },
        {
          name: '💀 Zeroed / Inactive Watchlist',
          value: leaderboard
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((p: any) => p.warriorScore.isDeadweight)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((p: any) => `⚠️ **${p.governor.name}** (-${(-p.deltas.power / 1000000).toFixed(1)}M Power | ${p.warriorScore.actualDkp.toLocaleString()} DKP)`)
            .join('\n') || '*None identified.*'
        }
      ],
      footer: {
        text: `RoK Command Center Automated Report`,
      },
      timestamp: new Date().toISOString()
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'RoK Command Center',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2855/2855663.png',
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error('Discord webhook rejected payload:', txt);
      return NextResponse.json({ error: 'Discord ignored the webhook.' }, { status: Math.max(response.status, 500) });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to notify Discord:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
