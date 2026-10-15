export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  RANKING: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** senha para zerar o ranking: npx wrangler secret put ADMIN_KEY -c server/wrangler.toml */
  ADMIN_KEY?: string;
}
