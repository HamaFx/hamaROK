import AssistantScreen from '@/features/assistant/assistant-screen';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const handoffRaw = params.handoff;
  const handoffToken = Array.isArray(handoffRaw) ? handoffRaw[0] : handoffRaw;
  return <AssistantScreen handoffToken={handoffToken || null} />;
}
