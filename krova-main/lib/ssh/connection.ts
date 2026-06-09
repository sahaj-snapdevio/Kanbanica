import { Client } from "ssh2";

const CONNECT_TIMEOUT = 30_000;
const MAX_RETRIES = 1;

export function createSshConnection(
  host: string,
  port: number,
  privateKey: string
): Promise<Client> {
  return attemptConnection(host, port, privateKey, 0);
}

function attemptConnection(
  host: string,
  port: number,
  privateKey: string,
  attempt: number
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(new Error(`SSH connection to ${host}:${port} timed out`));
      }
    }, CONNECT_TIMEOUT);

    client
      .on("ready", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(client);
        }
      })
      .on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          client.destroy();

          if (attempt < MAX_RETRIES) {
            attemptConnection(host, port, privateKey, attempt + 1).then(
              resolve,
              reject
            );
          } else {
            reject(
              new Error(
                `SSH connection to ${host}:${port} failed after ${attempt + 1} attempt(s): ${err.message}`
              )
            );
          }
        }
      })
      .connect({
        host,
        port,
        username: "root",
        privateKey,
        readyTimeout: CONNECT_TIMEOUT,
        // Prefer modern algorithms compatible with OpenSSH 9.6+ (Ubuntu 24.04)
        algorithms: {
          serverHostKey: [
            "ssh-ed25519",
            "ecdsa-sha2-nistp256",
            "ecdsa-sha2-nistp384",
            "rsa-sha2-512",
            "rsa-sha2-256",
          ],
        },
      });
  });
}
