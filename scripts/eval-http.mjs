/** Keep transport evidence for platform HTML errors without retaining response bodies. */
export async function evalRequest(base, method, path, body, fetcher = fetch) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const headers = { 'x-request-id': requestId, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  let response;
  try { response = await fetcher(`${base}${path}`, { method, headers, ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}) }); }
  catch {
    return { status: 599, data: { error: `Network request failed; requestId=${requestId}` }, transport: { method, path: path.split('?')[0], status: 599, requestId, networkError: true, durationMs: Date.now() - started } };
  }
  const raw = await response.text();
  let data = null; let json = true;
  try { data = raw ? JSON.parse(raw) : null; } catch { json = false; }
  const transport = { method, path: path.split('?')[0], status: response.status, requestId, responseRequestId: response.headers.get('x-request-id'), cfRay: response.headers.get('cf-ray'), contentType: response.headers.get('content-type'), json, bodyChars: raw.length, durationMs: Date.now() - started };
  if (response.status >= 400 && !data?.error) data = { error: `HTTP ${response.status}; ${json ? 'JSON' : 'non-JSON'} response; requestId=${requestId}; cfRay=${transport.cfRay ?? 'none'}; bodyChars=${raw.length}` };
  return { status: response.status, data, transport };
}
