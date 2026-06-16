export function normalizePgConnectionString(url: string): string {
  return url.replace(/^postgres:\/\//, "postgresql://");
}
