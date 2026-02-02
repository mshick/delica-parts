import { createClient, type Client } from "npm:@libsql/client/node";

let client: Client | null = null;

export function getClient(dbPath: string): Client {
  if (!client) {
    client = createClient({
      url: `file:${dbPath}`,
    });
  }
  return client;
}

export async function closeClient(): Promise<void> {
  if (client) {
    client.close();
    client = null;
  }
}
