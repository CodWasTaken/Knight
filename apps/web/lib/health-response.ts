import { checkReadiness } from './health';

export async function createReadyResponse(
  probes: Parameters<typeof checkReadiness>[0],
): Promise<Response> {
  const result = await checkReadiness(probes);
  return Response.json(result.body, { status: result.status });
}
