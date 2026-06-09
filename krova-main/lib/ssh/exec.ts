import type { Client } from "ssh2";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export function execCommand(
  client: Client,
  command: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    let activeStream: import("ssh2").ClientChannel | null = null;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (activeStream) {
          activeStream.close();
          activeStream.destroy();
        }
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        return;
      }

      activeStream = stream;

      stream
        .on("close", (code: number | null) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code ?? 1 });
          }
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}
