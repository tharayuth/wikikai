# Deploying WikiKai

This file covers running WikiKai on a remote server and connecting Claude Code clients to it.

## Quick local setup (already done on this machine)

1. **Token** — `.env` in repo root holds `WIKIKAI_TOKEN` (gitignored).
2. **MCP registration** — `~/.claude/settings.json` has:
   ```json
   {
     "mcpServers": {
       "wikikai": {
         "type": "http",
         "url": "http://127.0.0.1:3939/mcp",
         "headers": { "Authorization": "Bearer <TOKEN>" }
       }
     }
   }
   ```
3. **Skill** — `~/.claude/skills/wikikai/SKILL.md` teaches Claude when + how to use the tools.

Restart Claude Code after editing settings.json — it picks up MCP servers on launch.

## Production build

```bash
PATH=$HOME/.nvm/versions/node/v25.6.1/bin:$PATH npm run build
# → produces dist/ (server, compiled TS) + client/dist/ (static SPA)
```

Run with:
```bash
WIKIKAI_TOKEN=<token> node dist/index.js
```

The compiled `dist/index.js` loads `.env` from the project root via `process.loadEnvFile()` (Node 20.12+) — fine to use a shell-exported env instead.

## Running as a systemd service

`/etc/systemd/system/wikikai.service`:
```ini
[Unit]
Description=WikiKai MCP server
After=network.target

[Service]
Type=simple
User=wikikai
WorkingDirectory=/opt/wikikai
EnvironmentFile=/opt/wikikai/.env
ExecStart=/usr/bin/node /opt/wikikai/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wikikai
sudo journalctl -u wikikai -f
```

`.env` content on the server:
```
WIKIKAI_TOKEN=<a strong random token, openssl rand -hex 32>
HOST=127.0.0.1            # only accept localhost; reverse proxy exposes it
PORT=3939
PUBLIC_BASE_URL=https://wikikai.your-domain.tld
DATA_DIR=/var/lib/wikikai
```

Create `/var/lib/wikikai` owned by `wikikai:wikikai` (the service user). The DB and items live there.

## Reverse proxy (nginx + TLS)

`/etc/nginx/sites-available/wikikai`:
```nginx
server {
  listen 443 ssl http2;
  server_name wikikai.your-domain.tld;

  ssl_certificate     /etc/letsencrypt/live/wikikai.your-domain.tld/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/wikikai.your-domain.tld/privkey.pem;

  # SPA + static client + API + MCP all behind one origin
  location / {
    proxy_pass http://127.0.0.1:3939;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # MCP Streamable HTTP needs long-lived connections
    proxy_read_timeout 1d;
    proxy_send_timeout 1d;
    proxy_buffering off;
  }
}
```

Get the cert with `certbot --nginx -d wikikai.your-domain.tld`.

After this, update the client's `mcpServers.wikikai.url` in every `~/.claude/settings.json` to the HTTPS URL.

## Migrating data from local → server

```bash
# Stop both sides first to avoid concurrent writes.
rsync -av --delete /Users/kai/Dev/aiportal/data/ \
  wikikai@your-server:/var/lib/wikikai/

# Verify on the server
sudo -u wikikai sqlite3 /var/lib/wikikai/index.db "SELECT id, title FROM knowledge ORDER BY id;"
```

The SQLite DB plus `items/<kid>/<pid>.md` files are everything — no other state to migrate.

## Auth model

Currently `Authorization: Bearer <token>` is required only on `/mcp`. The web UI (`/`, `/api/*`, `/mermaid/...`, `/chart/...`) is **not** gated by the token because browsers don't send a custom Authorization header on page loads.

For an open internet deployment, protect the UI separately:
- Nginx `auth_basic` (simple)
- Nginx + OAuth2 proxy (better)
- Or run WikiKai on a VPN / Tailscale net and skip web auth entirely

Without one of these, anyone who can reach the URL can browse all knowledge — but they cannot write because writes go through MCP, which is token-gated.

## Healthcheck

Quick liveness probe:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3939/api/knowledge
# 200 = up
```

MCP auth probe:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3939/mcp -X POST
# 401 = auth enforced (good)
```

## Client setup checklist (for each new machine)

1. Edit `~/.claude/settings.json` → add `mcpServers.wikikai` with the right URL + token.
2. Copy `~/.claude/skills/wikikai/SKILL.md` from the source machine (or `git clone` a dotfiles repo).
3. Restart Claude Code.
4. Sanity check: ask Claude "list knowledge" — it should call `list_knowledge` via the MCP.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Claude says "wikikai tools not available" | settings.json missing/wrong | Check `mcpServers` block, restart Claude Code |
| `401 unauthorized` | wrong/missing token | Compare client `Authorization` header vs server `.env` |
| Web UI loads but tools 401 | viewing without MCP registered | Expected — UI is unauth, tools need MCP client |
| `406` from `/mcp` | MCP transport — not a JSON-RPC request | Normal for direct curl probes; means auth passed |
| SQLite "database is locked" | concurrent writers in WAL contention | Single-writer; rare. Restart fixes |
