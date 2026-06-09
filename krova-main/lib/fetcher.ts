export class FetchError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new FetchError(
      data.error || `Request failed (${res.status})`,
      res.status
    );
  }

  return res.json();
}
