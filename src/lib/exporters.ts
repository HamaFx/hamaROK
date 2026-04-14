import ExcelJS from 'exceljs';
import JSZip from 'jszip';

interface ExportComparison {
  governor: { id: string; governorId: string; name: string };
  snapshotA: Record<string, string>;
  snapshotB: Record<string, string>;
  deltas: Record<string, string>;
  warriorScore: {
    rank: number;
    totalScore: number;
    tier: string;
    actualDkp: number;
    expectedDkp?: number;
    expectedKp: number;
    expectedDeads?: number;
    kdRatio: number;
    isDeadweight: boolean;
  } | null;
  anomalies: Array<{ code: string; severity: string; message: string }>;
}

interface ExportResultPayload {
  eventA: { name: string };
  eventB: { name: string };
  comparisons: ExportComparison[];
  summary: {
    totalGovernors: number;
    avgWarriorScore: number;
    anomalyCount?: number;
  };
  trendLines?: Array<{
    eventA: { name: string; date?: string };
    eventB: { name: string; date?: string };
    avgWarriorScore: number;
    totalGovernors: number;
    anomalyCount: number;
  }>;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toComparisonCsv(payload: ExportResultPayload): string {
  const headers = [
    'Rank',
    'Governor',
    'Governor ID',
    'Power Start',
    'Power End',
    'Power Delta',
    'KP Delta',
    'T4 Delta',
    'T5 Delta',
    'Deads Delta',
    'Expected KP',
    'Expected Deads',
    'Expected DKP',
    'Actual DKP',
    'KD Ratio',
    'Score %',
    'Tier',
    'Deadweight',
    'Anomalies',
  ];

  const rows = payload.comparisons.map((item) => {
    const ws = item.warriorScore;
    return [
      ws?.rank ?? '',
      item.governor.name,
      item.governor.governorId,
      item.snapshotA.power,
      item.snapshotB.power,
      item.deltas.power,
      item.deltas.killPoints,
      item.deltas.t4Kills,
      item.deltas.t5Kills,
      item.deltas.deads,
      ws?.expectedKp ?? '',
      ws?.expectedDeads ?? '',
      ws?.expectedDkp ?? '',
      ws?.actualDkp ?? '',
      ws?.kdRatio ?? '',
      ws?.totalScore ?? '',
      ws?.tier ?? '',
      ws?.isDeadweight ? 'YES' : 'NO',
      item.anomalies.map((a) => `${a.code}:${a.severity}`).join('|'),
    ]
      .map(csvEscape)
      .join(',');
  });

  return `${headers.join(',')}\n${rows.join('\n')}`;
}

export async function toComparisonXlsx(
  payload: ExportResultPayload
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const comparisonSheet = workbook.addWorksheet('Comparisons');
  const anomalySheet = workbook.addWorksheet('Anomalies');

  comparisonSheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Governor', key: 'governor', width: 24 },
    { header: 'Governor ID', key: 'governorId', width: 16 },
    { header: 'Power Δ', key: 'powerDelta', width: 14 },
    { header: 'KP Δ', key: 'kpDelta', width: 14 },
    { header: 'T4 Δ', key: 't4Delta', width: 14 },
    { header: 'T5 Δ', key: 't5Delta', width: 14 },
    { header: 'Deads Δ', key: 'deadsDelta', width: 14 },
    { header: 'Expected DKP', key: 'expectedDkp', width: 16 },
    { header: 'Actual DKP', key: 'actualDkp', width: 16 },
    { header: 'Score %', key: 'score', width: 12 },
    { header: 'Tier', key: 'tier', width: 18 },
    { header: 'Deadweight', key: 'deadweight', width: 12 },
  ];

  for (const item of payload.comparisons) {
    const ws = item.warriorScore;
    comparisonSheet.addRow({
      rank: ws?.rank ?? '',
      governor: item.governor.name,
      governorId: item.governor.governorId,
      powerDelta: item.deltas.power,
      kpDelta: item.deltas.killPoints,
      t4Delta: item.deltas.t4Kills,
      t5Delta: item.deltas.t5Kills,
      deadsDelta: item.deltas.deads,
      expectedDkp: ws?.expectedDkp ?? '',
      actualDkp: ws?.actualDkp ?? '',
      score: ws?.totalScore ?? '',
      tier: ws?.tier ?? '',
      deadweight: ws?.isDeadweight ? 'YES' : 'NO',
    });
  }

  anomalySheet.columns = [
    { header: 'Governor', key: 'governor', width: 24 },
    { header: 'Code', key: 'code', width: 24 },
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Message', key: 'message', width: 50 },
  ];

  for (const item of payload.comparisons) {
    for (const anomaly of item.anomalies) {
      anomalySheet.addRow({
        governor: item.governor.name,
        code: anomaly.code,
        severity: anomaly.severity,
        message: anomaly.message,
      });
    }
  }

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.addRows([
    ['Event A', payload.eventA.name],
    ['Event B', payload.eventB.name],
    ['Total Governors', payload.summary.totalGovernors],
    ['Average Score', payload.summary.avgWarriorScore],
    ['Total Anomalies', payload.summary.anomalyCount ?? 0],
  ]);

  const uint8 = await workbook.xlsx.writeBuffer();
  return Buffer.from(uint8);
}

export async function toComparisonPackZip(
  payload: ExportResultPayload
): Promise<Buffer> {
  const zip = new JSZip();
  const csv = toComparisonCsv(payload);
  const xlsx = await toComparisonXlsx(payload);
  const reportJson = JSON.stringify(payload, null, 2);

  const readme = [
    '# HamaROK Report Pack',
    '',
    `Comparison: ${payload.eventA.name} -> ${payload.eventB.name}`,
    `Total Governors: ${payload.summary.totalGovernors}`,
    `Average Score: ${payload.summary.avgWarriorScore}`,
    `Total Anomalies: ${payload.summary.anomalyCount ?? 0}`,
    '',
    'Files:',
    '- comparison.csv: flat table for quick import',
    '- comparison.xlsx: workbook with summary/comparison/anomaly sheets',
    '- report.json: full API payload (reproducible snapshot)',
  ].join('\n');

  zip.file('README.md', readme);
  zip.file('comparison.csv', csv);
  zip.file('comparison.xlsx', xlsx);
  zip.file('report.json', reportJson);

  if (payload.trendLines && payload.trendLines.length > 0) {
    const trendCsv = [
      'Event A,Event B,Avg Warrior Score,Total Governors,Anomaly Count',
      ...payload.trendLines.map((line) =>
        [
          csvEscape(line.eventA.name),
          csvEscape(line.eventB.name),
          csvEscape(line.avgWarriorScore),
          csvEscape(line.totalGovernors),
          csvEscape(line.anomalyCount),
        ].join(',')
      ),
    ].join('\n');
    zip.file('trend-lines.csv', trendCsv);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
