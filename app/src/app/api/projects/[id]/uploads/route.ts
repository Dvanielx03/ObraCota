// Forward the request stream directly. Buffering a complete IFC in the panel
// would duplicate the backend's size check and consume memory per upload.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const target = new URL("/api/projects/" + id + "/uploads", process.env.API_INTERNAL_URL || "http://127.0.0.1:8080");
  target.search = new URL(request.url).search;
  const headers = new Headers();
  for (const key of ["authorization", "content-type", "content-length"]) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", body: request.body, headers, duplex: "half", signal: request.signal, redirect: "error",
  };
  const response = await fetch(target, init);
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
