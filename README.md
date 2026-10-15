# logicc2api

**English** · [简体中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JamesZhaoY/logicc2api)

This button creates a new Git repository. If you already have this project in your Git account, use [Deploy from an existing repository](#deploy-from-an-existing-repository).

> **Disclaimer:** Please read the [disclaimer and usage responsibilities (Simplified Chinese)](DISCLAIMER.md) before use. It covers account authorization, third-party service risks, data handling, and limitations of liability. The [MIT License](LICENSE) continues to govern the software license.

An OpenAI-compatible adapter for [Logicc](https://app.logicc.com), with account pool management and a web console. Run it with Node.js, Docker, or Cloudflare Workers. It converts Logicc's AI SDK v6 event stream into OpenAI Chat Completions / Responses and Anthropic Messages responses and shows account health, traffic, latency, and request history in one place.

Built with Node.js and plain HTML/CSS/JavaScript. **No runtime dependencies, database setup, or frontend build step.** The web interface is currently in Simplified Chinese; documentation is available in English and Chinese.

## Features

| Area | What it provides |
| --- | --- |
| Protocol compatibility | Model listing; JSON and SSE for Chat Completions, Responses, and Messages |
| Client tool calls | Standard tool_calls / function_call / tool_use and matching tool-result round trips |
| Account pool | Add, edit, remove, enable/disable, search, and bulk-import accounts |
| Upstream assistant prompts | Read, back up, edit, and publish assistant systemPrompt; select a default assistant per account |
| Credential refresh | On-demand Clerk JWT refresh, shared concurrent refreshes, and persistence of rotated client cookies |
| Scheduling | Prefer the least-busy accounts, round-robin between ties, and cool down failing accounts |
| Dashboard | Request trends, success rate, time to first text, and account availability |
| Models and logs | Live model discovery, observed model latency, request details, filters, and CSV export |
| Playground | Send a real streaming request, choose an upstream tool, and stop the local request |
| Persistent storage | Local files for Node/Docker; SQLite-backed Durable Object for Workers; raw cookies and JWTs are omitted from management responses |
| Cloudflare deployment | Deploy button, automatic resource setup, password-protected console, and a separate API key |

The console polls the adapter every five seconds. Account checks and model synchronization fetch the upstream model list; the playground sends real generation requests and uses your upstream quota.

## Quick start

Requires **Node.js 22 or newer** and a Logicc account/session you can use. For a container-based setup without installing Node.js on the host, see [Docker deployment](#docker-deployment).

```bash
git clone https://github.com/JamesZhaoY/logicc2api.git
cd logicc2api
npm start
```

There is no dependency installation step. You can also run `node server.mjs` directly.

1. Open **<http://127.0.0.1:18789/>**.
2. Go to **号池管理 → 添加账户** (Account pool → Add account), enter your credentials, and click **检测** (Check).
3. Point your client at **`http://127.0.0.1:18789/v1`**. Unless you configure `LOGICC_API_KEY`, use any non-empty API key, such as `local`.

To select a different port:

```bash
node server.mjs 18790
```

Native startup binds to `127.0.0.1` by default. Command-line port selection takes precedence over `PORT`.

## Cloudflare Workers deployment

Choose the entry point that matches your situation:

| Situation | Entry point | Git repository behavior |
| --- | --- | --- |
| Installing the project into your Git account for the first time | **Deploy to Cloudflare** button | Creates a new copy of the repository |
| You already own or have forked `logicc2api` | Cloudflare **Workers & Pages → Create application → Import a repository** | Connects your existing repository |

The button's **“A repository with this name already exists”** error refers to the GitHub/GitLab repository name: the template flow is trying to create another repository with that name. Deploy your existing repository using the import flow below.

### First-time installation with the deploy button

Click **Deploy to Cloudflare** at the top of this page. The [official deployment flow](https://developers.cloudflare.com/workers/platform/deploy-buttons/) copies this public repository into your GitHub/GitLab account, builds the Worker, and creates its Durable Object binding. No existing server or database setup is required.

1. Sign in to Cloudflare, connect your Git provider, and choose a repository/Worker name.
2. Set the two secrets requested by the deployment form. Generate **two different values**, for example by running `openssl rand -hex 32` twice:

   | Secret | Purpose |
   | --- | --- |
   | `LOGICC_ADMIN_PASSWORD` | Console password; the username is **`admin`** |
   | `LOGICC_API_KEY` | Client API key for `/v1/*`; separate from the console password |

3. Keep the deploy command **`npm run deploy`** (or `npx wrangler deploy`). No build command is needed.
4. Open the resulting `https://<worker>.<subdomain>.workers.dev/` address and sign in using the browser's authentication prompt.
5. Add **your own Logicc account** under **号池管理 → 添加账户**. Account credentials are entered after deployment; they are not supplied by this repository or the deployment button.
6. Set your OpenAI client's Base URL to `https://<worker>.<subdomain>.workers.dev/v1` and its API key to `LOGICC_API_KEY`. For Anthropic clients, omit `/v1` from the Base URL.

### Deploy from an existing repository

1. Leave the template deployment page. In Cloudflare, open **Workers & Pages → Create application → Import a repository**.
2. Select your Git account and the existing `logicc2api` repository, for example `JamesZhaoY/logicc2api`.
3. Configure the project, then select **Save and Deploy**:

   | Setting | Value |
   | --- | --- |
   | Worker name | `logicc2api` |
   | Production branch | `main` |
   | Root directory | Repository root (default) |
   | Build command | Leave empty |
   | Deploy command | `npm run deploy` |

4. Configure `LOGICC_ADMIN_PASSWORD` and `LOGICC_API_KEY` as **runtime secrets** under the Worker's **Settings → Variables and Secrets**. Build variables/secrets only exist during the build and do not automatically become Worker runtime secrets. If the first build reports missing required secrets, add them here and retry the deployment.
5. Once deployed, open the Worker URL, sign in as `admin`, and add your own Logicc account through the console.

The Worker name must match `name` in `wrangler.jsonc`; update both if you choose a different Worker name. The Git repository itself can keep its existing name. Subsequent pushes to `main` automatically build and deploy this connected Worker. If the Worker already exists in Cloudflare, connect the repository through **that Worker → Settings → Builds → Connect**. See the [official Git integration guide](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build configuration reference](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

### Runtime behavior and storage

The Worker serves the existing console and all three APIs, including SSE and client tool calls. Accounts, rotated cookies, request metadata, assistant prompt snapshots, and default assistant selections persist in a [SQLite-backed Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). Each deployment starts with its own empty account pool; it does not import local Docker data. Storage and requests use your Cloudflare account's quotas.

Both secrets are required: missing/empty values cause HTTP 503. The console and management APIs require the admin password; `/v1/*` requires the API key. The local `/__set_token` bridge and external token-file/command refresh are unavailable in Workers. Cookie-based refresh remains supported. Responses history remains in memory for up to 30 minutes and may be lost on a Durable Object restart; send full `input` history if a previous response is unavailable. Upstream access depends on Logicc accepting requests from Cloudflare's network.

### CLI deployment and local testing

```bash
npm ci
npx wrangler login
npx wrangler secret put LOGICC_ADMIN_PASSWORD
npx wrangler secret put LOGICC_API_KEY
npm run deploy
```

If Wrangler offers to create the Worker while setting the first secret, accept. The subsequent deployment creates the Durable Object. Store values as [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), not in `wrangler.jsonc` or a README.

For local development, copy `.dev.vars.example` to `.dev.vars`, fill in both values, then run `npm run dev:worker`. `.dev.vars` and `.wrangler/` are ignored by Git. `npm run test:worker` exercises the local Workers runtime with generated credentials and a mock upstream; it does not use your Logicc account. `npm run build:worker` validates the deployment bundle without publishing.

## Docker deployment

Requires Docker Engine with the Compose plugin, or Docker Desktop. The repository includes a [Dockerfile](Dockerfile) and [compose.yaml](compose.yaml); the image is built locally from source.

### Start with Docker Compose

```bash
git clone https://github.com/JamesZhaoY/logicc2api.git
cd logicc2api
docker compose up -d --build --wait
```

If you already cloned the repository, run the last command from its root directory. Open **<http://127.0.0.1:18789/>**, add an account, and use **`http://127.0.0.1:18789/v1`** as your client's Base URL.

The image uses Node.js 24 Alpine and runs as the non-root `node` user. Inside the container, `LOGICC_HOST=0.0.0.0` allows Docker's port forwarding to reach the server. Compose publishes the port only on the host's `127.0.0.1`. The image health check calls `/health`; a healthy container means the service is running, not that an upstream account has passed a check.

### Change the port or API key

Create a local `.env` file next to `compose.yaml`, for example:

```dotenv
LOGICC_PORT=18790
LOGICC_API_KEY=replace-with-your-own-key
```

```bash
docker compose up -d --wait
```

Then use `http://127.0.0.1:18790/` and supply the configured Bearer key for `/v1/*`. Both variables are optional; the defaults are port `18789` and no API key requirement. Use another port if a native instance already occupies `18789`. Keep the settings in `.env` so subsequent Compose commands use the same configuration. Compose reads these values through [environment interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/); the file is ignored by Git and excluded from the image build.

`LOGICC_PORT` changes the container port and published port together because the server validates the HTTP Host port. When writing a custom `docker run` command, keep the two ports equal and set `PORT` inside the container if changing the default. An API key protects `/v1/*`; it does not add an admin login to the console.

### Data, logs, and upgrades

Compose stores `/app/data` in the named volume `logicc2api_logicc-data` (or `<project-name>_logicc-data` when using `-p`). Accounts, request records, and rotated credentials survive container recreation. The image build excludes your local `data/`, `.env`, logs, and backups; an existing native installation is not imported automatically. Add your accounts through the console when starting a fresh container.

```bash
# Status and logs
docker compose ps
docker compose logs -f --tail=100 logicc2api

# Update source and rebuild; retain the same data volume
git pull --ff-only
docker compose up -d --build --wait

# Stop and remove containers while keeping account data
docker compose down
```

Do not add `--volumes` / `-v` to `docker compose down` unless you intend to delete the account data. Named volume behavior is documented in [Docker's volume guide](https://docs.docker.com/engine/storage/volumes/).

For deployment on a remote server, access the local-only console through an SSH tunnel from your computer:

```bash
ssh -N -L 18789:127.0.0.1:18789 your-user@your-server
```

Then open `http://127.0.0.1:18789/` on your computer. Adjust both port numbers if you configured another port. The existing local-origin checks remain in effect; public-domain hosting requires a separate authentication/access design.

### Troubleshoot `fetch failed` / DNS errors in Docker

If requests fail while the container remains healthy, check the request log. Network failures include the upstream hostname and a known error code: `EAI_AGAIN` / `ENOTFOUND` indicates DNS resolution failed. A successful `/health` check only confirms the local service is running.

Docker Desktop's DNS forwarder may time out on IPv6 (AAAA) queries even when the host resolves the domain. After verifying that another DNS server works from the container, create a **local** `compose.override.yaml` using that resolver. For example, if `223.5.5.5` works in your environment:

```yaml
services:
  logicc2api:
    dns:
      - 223.5.5.5
```

Run `docker compose up -d --wait` to apply it. Compose loads the override automatically and retains the data volume. This file is ignored by Git; other deployments keep their own DNS settings. DNS failures alone do not establish that your Logicc credentials are invalid. See [Docker's DNS configuration guidance](https://docs.docker.com/desktop/features/networking/networking-how-tos/).

## Account credentials

The account form accepts any of the following:

| Input | Behavior |
| --- | --- |
| `__client` Cookie + Session ID | Obtain fresh session JWTs on demand |
| `__client` Cookie + Session JWT | Read the Session ID from the JWT's `sid` claim, then refresh on demand |
| Session JWT only | Use it until it expires; replace it manually or push a new JWT through `/__set_token` |

For your logged-in account, open browser DevTools → Application → Cookies → `clerk.logicc.com` and copy the **value** of `__client`. A Session ID starts with `sess_`. A Session JWT can be obtained in the Logicc page's console:

```js
await window.Clerk.session.getToken({ skipCache: true })
```

The `__session` cookie contains a short-lived session JWT; it is not the same credential as `__client`. A session can be revoked or signed out, so automatic refresh does not imply permanent access.

When editing an account, leaving a credential field blank preserves its saved value. Changing the client cookie or Session ID clears the cached JWT. Disabling or removing an account affects the local pool; it does not delete the upstream account.

### Bulk import

Paste a JSON array or upload a JSON file in **批量导入** (Bulk import):

```json
[
  {
    "name": "Work account",
    "clientCookie": "YOUR_CLIENT_COOKIE",
    "sessionId": "sess_YOUR_SESSION_ID",
    "enabled": true
  }
]
```

`{ "accounts": [...] }` is also accepted. JWT-only entries use `name` and `token`. The pool holds up to 200 accounts. Duplicate Session IDs are rejected, and the whole batch is validated before any account is added.

## API usage

### List models

```bash
curl http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer local'
```

Available models are read from the selected upstream account rather than hardcoded.

### Generate a response

```bash
curl http://127.0.0.1:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

### Stream a response

```bash
curl -N http://127.0.0.1:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{
    "model": "default",
    "stream": true,
    "stream_options": {"include_usage": true},
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

Omitting `model`, or using `default`, selects the upstream default model (or the first available model). Streaming responses use `chat.completion.chunk` and end with `[DONE]`. Set `stream: false`, or omit it, for a complete JSON response.

Upstream token usage is converted when available. When it is absent, API responses use zero counters for compatibility; the console marks usage as unavailable rather than estimating it.

### Responses protocol

`POST /v1/responses` accepts string or message-array `input` and supports `instructions`, `reasoning.effort`, function tools, `tool_choice`, and `stream`.

```bash
curl http://127.0.0.1:18789/v1/responses \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{"model":"default","input":"Introduce yourself in one sentence.","stream":true,"store":false}'
```

Streaming includes `response.created`, `response.output_text.delta`, `response.function_call_arguments.delta`, and `response.completed`; failures emit `response.failed`. Function calls appear as `function_call` output items. Execute the function in your client and return `function_call_output` with its `call_id`. Responses `custom` tools support string inputs as `custom_tool_call` items and accept `custom_tool_call_output` results.

The default `store: true` temporarily retains responses and conversation history **in process memory**, bounded to 30 minutes, 128 entries, and 16 MiB with oldest-entry eviction. Continue with `previous_response_id`, retrieve with `GET /v1/responses/{id}`, or delete with `DELETE /v1/responses/{id}`. A restart clears this cache; it is never written to the account file. With `store: false`, send the full conversation history yourself. Top-level `instructions` are not automatically inherited by the next request.

### Messages protocol

`POST /v1/messages` supports `system`, text content blocks, `tools[].input_schema`, `tool_choice`, `tool_use`, and `tool_result`. If a proxy API key is configured, use either `x-api-key` or Bearer authentication.

For clients that mix request formats, this adapter also accepts `system` / `developer` roles inside `messages`, Chat-style `assistant.tool_calls`, and `role: tool` with `tool_call_id`. Top-level `system` and inline instructions are both retained, with their roles and relative order preserved. Nested `tools[].function` definitions and `tool_choice: {type: "function", function: {name: "..."}}` are supported too. Responses still use the Messages JSON/SSE format, including `tool_use` blocks; `/v1/messages/count_tokens` accepts the same inputs.

Tool results must reference an earlier assistant call (`tool_use` or `tool_calls`) by ID. Missing calls, missing IDs, or duplicate results still return HTTP 400 with a specific validation error; the adapter does not invent missing tool history.

```bash
curl http://127.0.0.1:18789/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: local' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"default","max_tokens":512,"stream":true,"messages":[{"role":"user","content":"Introduce yourself in one sentence."}]}'
```

For SDK configuration, use `http://127.0.0.1:18789/v1` as the OpenAI `baseURL`, and `http://127.0.0.1:18789` as the Anthropic `baseURL` (without `/v1`).

SSE responses use `message_start`, `content_block_start/delta/stop`, `message_delta`, and `message_stop`. Tool arguments are emitted as `input_json_delta`, with `stop_reason: tool_use`. Execute the tool in your client, then send a user message containing `tool_result` with the matching `tool_use_id`.

`POST /v1/messages/count_tokens` returns a local estimate with the header `X-Logicc-Token-Count: estimated`. This helps clients estimate context size; it is not the upstream tokenizer's count and must not be used for billing.

### Client function calling

All three protocols share tool handling and preserve call/result IDs:

| Protocol | Tool definition | Returned call | Client result |
| --- | --- | --- | --- |
| Chat Completions | `type: function` and nested `function` | `message.tool_calls`; `finish_reason: tool_calls` | `role: tool` + `tool_call_id` |
| Responses | `type: function` with top-level `name/parameters` | `output[].type: function_call` | `type: function_call_output` + `call_id` |
| Messages | `name` + `input_schema` | `content[].type: tool_use`; `stop_reason: tool_use` | `type: tool_result` + `tool_use_id` |

Example Chat Completions function request:

```json
{
  "model": "default",
  "messages": [{"role": "user", "content": "Get the current weather in Hangzhou using get_weather."}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "The client looks up live weather for a city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"]
      }
    }
  }],
  "tool_choice": "required"
}
```

Your **client** executes the returned function. Include the original user message, the assistant message containing `tool_calls`, and a `role: tool` result message in the next request. Sending only the result loses the context and call-ID association.

Supported choices include `auto`, `none`, `required` / Messages `any`, named tools, and disabling parallel calls. `none` does not interpret text JSON as an executable call. If a required call cannot be generated, the adapter returns an explicit error rather than fabricating success. Validation covers JSON syntax, declared tool names, required fields, basic types, enum values, and basic object property constraints.

**Implementation boundary:** Logicc's current chat endpoint does not register arbitrary client functions. This adapter uses a structured prompt to generate tool requests and converts them into the client's protocol. Plain text streams immediately; responses with client tools are buffered for JSON validation before protocol events are sent. Reliability depends on the upstream model. This is not native constrained decoding, full JSON Schema `strict` validation, or a custom grammar validator. The adapter never executes your client's shell, file, or network tools.

### Upstream built-ins and remaining limits

- To request Logicc's built-in tools, send `tools: [{"type":"web_search"}]` or `[{"type":"image_generation"}]`; `web_search_preview` also maps to built-in search. The console playground uses this form.
- **A function named `web_search` remains a client function and is no longer silently replaced by upstream search.** This fixes the previous tool-routing behavior.
- Provider-executed tools are not executed a second time by the client. Built-in tool activity may still appear as text markers.
- Each request creates an upstream chat; conversation roles, tool calls, and results are preserved while being serialized into one prompt.
- `reasoning_effort` / Responses `reasoning.effort` are forwarded; provider-specific reasoning/thinking blocks are not exposed.
- `max_tokens`, `max_completion_tokens`, and `max_output_tokens` are length instructions, not hard upstream token caps. `temperature` / `top_p` do not control upstream sampling.
- Attachments, Responses JSON Schema text output, background tasks, WebSockets, the Conversations API, and the complete OpenAI / Anthropic API are not implemented. Image-tool output is displayed as text in the playground.

Protocol references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), and [Anthropic Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).

## Upstream assistant prompts

Open **开发者 → 助手提示词** (Developer → Assistant prompts), or visit <http://127.0.0.1:18789/#prompts>.

1. Choose a pool account and browse its library, organization-shared assistants, or curated templates.
2. Selecting an assistant reads the actual `systemPrompt` from Logicc and displays the account's permissions. If upstream does not expose the text, the UI says so instead of generating substitute instructions.
3. Owners and editors can save and publish; other permissions are read-only. Saving follows the upstream draft workflow: read/create draft, update only `systemPrompt`, publish, and read back to verify. Model, tools, files, and other settings are preserved.
4. An existing upstream draft is shown explicitly. Publishing also publishes any changes already in that draft. If the upstream configuration changes after you load it, the update is rejected as a conflict so you can reload and review it.
5. Optionally select **设为代理默认助手** (Use as proxy default). New proxy requests assigned to this account create their upstream chat with that assistant ID, across all three protocols. When `model` is omitted or `default`, the selected assistant's model is preferred; an explicit request model takes precedence. Clearing the default restores ordinary chats.

If the library is empty, create a private assistant from this page. New assistants start with upstream web search and image generation disabled; those capabilities can be changed later on the Logicc website.

Prompt snapshots and default selections are stored separately in `assistant-prompts.json` beside the account data file. It retains up to 200 recently read assistant snapshots, including each retained assistant's first-read text and latest text. The file uses `0600` permissions, persists in the Docker data volume, and is excluded from Git. Loading the first-read backup into the editor does not change upstream until you explicitly save.

These are **upstream assistant instructions**, not Logicc's hidden platform-wide system prompt. The latter has not been obtained from a verifiable source, and no modification endpoint has been identified. How precisely custom assistant instructions are followed still depends on the upstream platform and model.

## Scheduling and refresh behavior

- Enabled, eligible accounts with the fewest in-flight requests are preferred. Ties use round-robin selection, and one account handles the entire chat request.
- HTTP 429 triggers a 60-second cooldown; 401/403 trigger five minutes; upstream server errors trigger 15 seconds. Later requests skip cooling accounts.
- An eligible account can participate again when its cooldown ends. Checking or updating an account also allows recovery. A failed request is not replayed on a different account.
- A JWT with fewer than ten seconds remaining is refreshed on demand. An upstream 401 triggers a forced refresh and one retry.
- Concurrent refreshes for the same account share one operation. New `__client` values returned by Clerk are persisted.
- Clerk refresh uses `POST /v1/client/sessions/{sid}/tokens`.

## Configuration and data

| Environment variable | Purpose |
| --- | --- |
| `PORT` | Listening port; default `18789` |
| `LOGICC_HOST` | Bind address; native default `127.0.0.1`, container default `0.0.0.0` |
| `LOGICC_DATA_FILE` | State path; default `data/state.json` in the project directory |
| `LOGICC_API_KEY` | Optional Bearer key required for `/v1/*` |
| `LOGICC_API_BASE` | Upstream base URL; default `https://app.logicc.com/api` |
| `LOGICC_CLERK_BASE` | Clerk base URL; default `https://clerk.logicc.com` |
| `LOGICC_CLIENT_COOKIE` | Import a default account into an empty pool |
| `LOGICC_SESSION_ID` | Session ID for the environment-imported account; alternatively read from a JWT |
| `LOGICC_TOKEN` | Initial JWT for the environment-imported account |
| `LOGICC_TOKEN_FILE` | External JWT file for the environment-imported account |
| `LOGICC_TOKEN_CMD` | External JWT refresh command for that account; configured only through the process environment |

Native Node.js startup does not load `.env` files automatically. Export variables in your shell or, on a compatible Node.js version, start with `node --env-file=.env server.mjs`. Docker Compose reads `.env` for the `LOGICC_PORT` and `LOGICC_API_KEY` mappings above; `LOGICC_PORT` is a Compose setting, not a native server setting. Other environment variables must be explicitly added to the Compose service if needed.

Existing saved accounts take precedence over initial environment credentials, so old environment values do not overwrite rotated cookies. If you use an external refresh command or token file, keep providing its configuration when starting the service.

`data/state.json` contains credentials, the cached model catalog, cooldowns, and at most 2,000 recent request metadata records. Writes use a temporary file plus rename, with a requested file mode of `0600`. The file is **plaintext**, and filesystem permission enforcement depends on the platform. Runtime data, environment files, logs, backups, and browser test artifacts are excluded from Git.

The dashboard summarizes retained chat records from the previous 24 hours. Model discovery and account checks appear in logs but are excluded from chat metrics. The log page displays the latest 200 records. First-text latency includes credential refresh, chat creation, and network time. Prompts and generated answers are not stored in request logs.

The **Node/Docker console** is intended for a single local process, with no separate admin login. Management requests require the local origin/Host checks and `X-Logicc-Admin: 1`; `LOGICC_API_KEY` protects `/v1/*`, not the local console. The local compatibility endpoint `POST /__set_token` accepts a raw JWT, optionally with `?account_id=<id>`, and permits the Logicc page origin. JWTs are matched to accounts by Session ID. Workers uses the separate password and storage rules described above.

Do not run multiple instances against the same state file. Use separate `LOGICC_DATA_FILE` paths and ports for independent instances.

### Keeping Logicc credentials out of Git

`.gitignore` excludes account state, assistant snapshots, `.env*`, `.dev.vars*`, credential/account exports, token and cookie text files, private keys, browser session state, HAR/PCAP captures, backups, and Wrangler's local state. Only empty/example environment templates are permitted. Docker uses a source-file allowlist; Workers static assets are limited to `public/`.

Before publishing, run `npm run check:secrets`. It reports suspicious filenames and line numbers without printing credential values. This focused check cannot detect every possible secret format. If a real credential has already been published, an ignore rule does not remove Git history; revoke the affected Logicc session and remove exposed content from current files and history.

GitHub Actions runs credential checks, protocol tests, Workers integration tests, and deployment build checks on pushes and pull requests.

## Development and tests

```bash
npm test
```

Tests use Node's built-in test runner and a local mock upstream. They cover account CRUD and atomic import, credential masking and file permissions, scheduling and cooldowns, forced refresh and cookie rotation, concurrent refreshes, JSON/SSE conversion, tool-call/result round trips across all three APIs, usage and failure statistics, origin restrictions, and malformed input. They do not need real credentials or consume upstream quota.

```text
server.mjs              HTTP routes, upstream calls, and temporary Responses history
protocols.mjs           Request, tool-call, JSON, and SSE conversion for all three APIs
assistants.mjs          Upstream drafts/publication, separate prompt backups, and assistant defaults
pool.mjs                Account storage, credential refresh, scheduling, and metrics
public/                 Web console, served without a build step
test/adapter.test.mjs    Integration and protocol checks
Dockerfile              Non-root container image and service health check
compose.yaml            Local port mapping and persistent account data
worker.mjs              Authenticated Workers entry point and durable account storage
wrangler.jsonc          Worker assets, secrets, and automatic Durable Object migration
test/worker.integration.mjs  Local Workers runtime integration checks
```

## License

[MIT](LICENSE) © 2026 JamesZhaoY.
