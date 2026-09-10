export async function GET(): Promise<Response> {
  return Response.json({ status: 'live' }, { status: 200 });
}
