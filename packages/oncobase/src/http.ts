// Shared response-body reader for publisher HTTP calls. The
// /api/publish/* route returns `{step, error}` JSON on uncaught
// failures; older deployments and Vercel's function-crashed page
// return plain text. This helper renders both cleanly so error
// messages from the publisher CLI are actionable.

export async function readErrorBody(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { step?: string; error?: string };
    if (parsed.error) {
      return parsed.step
        ? `${parsed.step}: ${parsed.error}`
        : parsed.error;
    }
  } catch {
    // not JSON
  }
  return raw;
}
