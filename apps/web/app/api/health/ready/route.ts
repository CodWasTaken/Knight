import { createReadyResponse } from '../../../../lib/health-response';

export async function GET(): Promise<Response> {
  const { getHealthProbes } = await import('../../../../lib/health-runtime');
  return createReadyResponse(getHealthProbes());
}
