export async function GET() {
  return Response.json({
    service: "morpheus-web",
    status: "online",
    timestamp: new Date().toISOString()
  });
}
