# logicc2api

[English](README.md) · **简体中文**

[![一键部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/JamesZhaoY/logicc2api)

此按钮会新建 Git 仓库。你的 Git 账户中已有本项目时，请使用[从已有仓库部署](#从已有仓库部署)。

> **免责声明：** 使用前请阅读[《免责声明与使用责任说明》](DISCLAIMER.md)，了解账户授权、第三方服务风险、数据处理及责任限制。软件许可继续适用 [MIT License](LICENSE)。

为 [Logicc](https://app.logicc.com) 提供 OpenAI 兼容接口的代理，内置号池管理和 Web 控制台，支持 Node.js、Docker 和 Cloudflare Workers 部署。将 Logicc 的 AI SDK v6 数据流转换成 OpenAI Chat Completions / Responses 和 Anthropic Messages 响应，集中查看账户状态、流量、模型延迟和请求日志。

使用 Node.js 与原生 HTML/CSS/JavaScript 实现。**零第三方运行时依赖，无需手动配置数据库，无需前端构建。** 当前页面为简体中文，同时提供中英文介绍文档。

## 功能

| 模块 | 功能说明 |
| --- | --- |
| 协议兼容 | 模型列表，Chat Completions、Responses、Messages 的 JSON / SSE 接口 |
| 客户端工具调用 | 标准 tool_calls / function_call / tool_use，以及工具结果回传 |
| 号池管理 | 账户增删改、启停、搜索、JSON 批量导入 |
| 上游助手提示词 | 读取、备份、编辑并发布助手 systemPrompt，按账号选择代理默认助手 |
| 凭据刷新 | 按需刷新 Clerk JWT、合并同账户的并发刷新、保存轮换后的 Cookie |
| 账户调度 | 最低并发优先，同等并发轮询，异常账户自动冷却 |
| 运行看板 | 请求趋势、成功率、首字延迟和账户可用性 |
| 模型与日志 | 实时同步模型、统计实际延迟、查看请求详情、筛选和导出 CSV |
| 请求测试 | 发送真实流式请求、选择上游内置工具、停止本地请求 |
| 持久化存储 | Node/Docker 使用本地文件，Workers 使用 SQLite Durable Object；管理接口不返回原始 Cookie 和 JWT |
| Cloudflare 部署 | 一键部署按钮、自动创建存储、控制台密码与独立 API Key |

页面每 5 秒读取代理状态；自动刷新不会调用上游。账号检测和模型同步仅获取模型列表；请求测试会生成内容并消耗上游额度。

## 快速开始

需要 **Node.js 22 或更新版本**，以及可使用的 Logicc 账户与会话。如果不想在宿主机安装 Node.js，可使用下方的 [Docker 部署](#docker-部署)。

```bash
git clone https://github.com/JamesZhaoY/logicc2api.git
cd logicc2api
npm start
```

无需安装依赖，也可以直接执行 `node server.mjs`。

1. 打开 **<http://127.0.0.1:18789/>**。
2. 进入 **号池管理 → 添加账户**，填写凭据后点击 **检测**。
3. 在客户端中设置 Base URL 为 **`http://127.0.0.1:18789/v1`**。未配置 `LOGICC_API_KEY` 时，API Key 填任意非空字符串，例如 `local`。

自定义端口：

```bash
node server.mjs 18790
```

直接使用 Node.js 启动时默认监听 `127.0.0.1`，命令行端口优先于环境变量 `PORT`。

## Cloudflare Workers 一键部署

请根据自己的情况选择入口：

| 使用场景 | 部署入口 | Git 仓库的处理方式 |
| --- | --- | --- |
| 第一次把项目安装到自己的 Git 账户 | **Deploy to Cloudflare** 按钮 | 创建一份新的仓库副本 |
| 已经拥有或 Fork 了 `logicc2api` | Cloudflare **Workers & Pages → 创建应用 → 导入仓库** | 连接已有仓库 |

按钮页面提示 **“已存在具有该名称的存储库”**，指的是 GitHub/GitLab 仓库重名：模板流程正在尝试创建另一个同名仓库。已有项目应使用下方的导入流程直接部署。

### 首次安装：使用一键部署按钮

点击文档顶部的 **Deploy to Cloudflare** 按钮。[官方部署流程](https://developers.cloudflare.com/workers/platform/deploy-buttons/)会把公开仓库复制到你的 GitHub/GitLab 账户，构建 Worker 并自动创建 Durable Object 存储绑定，无需预先准备服务器或数据库。

1. 登录 Cloudflare，连接 Git 账户，设置仓库和 Worker 名称。
2. 在部署页面填写两个 Secret。请生成**两个不同的随机值**，例如执行两次 `openssl rand -hex 32`：

   | Secret | 用途 |
   | --- | --- |
   | `LOGICC_ADMIN_PASSWORD` | 管理控制台密码，用户名固定为 **`admin`** |
   | `LOGICC_API_KEY` | `/v1/*` 客户端访问密钥，与管理密码分开设置 |

3. 部署命令保留 **`npm run deploy`** 或 `npx wrangler deploy`，无需填写构建命令。
4. 部署完成后，打开 `https://<worker>.<subdomain>.workers.dev/`，在浏览器登录框中输入管理员用户名和密码。
5. 进入 **号池管理 → 添加账户**，填写**你自己的 Logicc 凭据**。账号在部署后添加，仓库和部署按钮不会附带作者的账号。
6. OpenAI 客户端 Base URL 填 `https://<worker>.<subdomain>.workers.dev/v1`，API Key 使用 `LOGICC_API_KEY`。Anthropic 客户端 Base URL 不带 `/v1`。

### 从已有仓库部署

1. 退出模板部署页面，进入 Cloudflare **Workers & Pages → 创建应用 → 导入仓库**。
2. 选择自己的 Git 账户和已有的 `logicc2api` 仓库，例如 `JamesZhaoY/logicc2api`。
3. 填写以下项目配置，然后点击 **保存并部署**：

   | 配置项 | 填写值 |
   | --- | --- |
   | Worker 名称 | `logicc2api` |
   | 生产分支 | `main` |
   | 根目录 | 仓库根目录，保留默认值 |
   | 构建命令 | 留空 |
   | 部署命令 | `npm run deploy` |

4. 在该 Worker 的 **设置 → 变量和机密** 中，以 Secret 类型添加 **运行时密钥** `LOGICC_ADMIN_PASSWORD` 和 `LOGICC_API_KEY`。构建变量/机密仅在构建过程中可用，不会自动成为 Worker 运行时密钥。如果首次构建提示缺少必填 Secret，在这里补齐后重新部署。
5. 部署成功后，打开 Worker 地址，以 `admin` 登录，再通过控制台添加自己的 Logicc 账号。

Worker 名称必须与 `wrangler.jsonc` 中的 `name` 一致；自定义 Worker 名称时，应同步修改两处。Git 仓库可以保留已有名称。连接后，向 `main` 分支推送代码就会自动构建和部署。如果 Cloudflare 中也已经创建了 Worker，可进入 **该 Worker → 设置 → 构建 → 连接仓库**。详见[官方 Git 集成说明](https://developers.cloudflare.com/workers/ci-cd/builds/)和[构建配置说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

### 运行方式与存储

Worker 提供现有管理页面和三种协议接口，包括 SSE 和客户端工具调用。号池、轮换后的 Cookie、请求元数据、助手提示词快照与默认助手保存在 [SQLite Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) 中。每次独立部署有自己的空号池，不会自动导入本地 Docker 的数据。存储与请求占用你自己的 Cloudflare 账户配额。

两个 Secret 均为必填；缺失或为空时服务返回 HTTP 503。控制台和管理接口需要管理员密码，`/v1/*` 需要 API Key。Workers 不提供本机 `/__set_token` 桥接，也不支持外部令牌文件或命令刷新；Cookie 刷新仍可使用。Responses 临时历史保存在内存中，最长保留 30 分钟，对象重启时可能失效；找不到之前的 Response 时，请重新发送完整 `input` 历史。实际调用仍取决于 Logicc 是否接受 Cloudflare 网络的访问。

### 命令行部署与本地测试

```bash
npm ci
npx wrangler login
npx wrangler secret put LOGICC_ADMIN_PASSWORD
npx wrangler secret put LOGICC_API_KEY
npm run deploy
```

首次写入 Secret 时，如果 Wrangler 提示创建 Worker，请确认创建。后续部署会创建 Durable Object。密钥应保存在 [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) 中，不要写入 `wrangler.jsonc` 或说明文档。

本地开发时，将 `.dev.vars.example` 复制为 `.dev.vars`，填写两个值后运行 `npm run dev:worker`。`.dev.vars` 和 `.wrangler/` 均被 Git 忽略。`npm run test:worker` 使用自动生成的测试凭据和模拟上游检查本地 Workers 运行时，不使用你的 Logicc 账号；`npm run build:worker` 检查部署构建，不会发布服务。

## Docker 部署

需要安装带 Compose 插件的 Docker Engine，或 Docker Desktop。仓库已提供 [Dockerfile](Dockerfile) 和 [compose.yaml](compose.yaml)，镜像从源码在本机构建。

### 使用 Docker Compose 启动

```bash
git clone https://github.com/JamesZhaoY/logicc2api.git
cd logicc2api
docker compose up -d --build --wait
```

如果已经克隆仓库，在项目根目录执行最后一条命令即可。启动后打开 **<http://127.0.0.1:18789/>**，在号池中添加账户，客户端 Base URL 填 **`http://127.0.0.1:18789/v1`**。

镜像基于 Node.js 24 Alpine，使用非 root 的 `node` 用户运行。容器内设置 `LOGICC_HOST=0.0.0.0`，使 Docker 端口转发可以连接服务；Compose 只把端口发布到宿主机的 `127.0.0.1`。镜像通过 `/health` 检查服务是否存活；容器显示 healthy 不代表上游账户已经通过连接检测。

### 修改端口或设置 API Key

在 `compose.yaml` 同级创建本地 `.env` 文件，例如：

```dotenv
LOGICC_PORT=18790
LOGICC_API_KEY=replace-with-your-own-key
```

```bash
docker compose up -d --wait
```

之后访问 `http://127.0.0.1:18790/`，调用 `/v1/*` 时携带配置的 Bearer Key。两个变量均可省略，默认端口为 `18789`、不要求 API Key。如果本机原有 Node.js 服务已占用 `18789`，请选择其他端口。把配置保存在 `.env` 中，可以保证后续 Compose 命令使用同一组设置。Compose 通过[环境变量插值](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)读取配置；该文件被 Git 忽略，也不会进入镜像构建。

由于服务会校验 HTTP Host 中的端口，`LOGICC_PORT` 会同步调整容器内和宿主机端口。自行编写 `docker run` 命令时，也应保持两侧端口一致；修改默认端口时需设置容器内的 `PORT`。API Key 仅保护 `/v1/*`，不会为控制台增加管理员登录。

### 数据、日志与更新

Compose 将 `/app/data` 保存到命名卷 `logicc2api_logicc-data`；使用 `-p` 自定义项目名时，卷名为 `<项目名>_logicc-data`。容器重建后，账户、请求记录和轮换后的凭据仍会保留。镜像构建会排除本地 `data/`、`.env`、日志和备份，不会自动导入原有 Node.js 实例的数据；新容器请通过控制台添加账户。

```bash
# 查看状态和日志
docker compose ps
docker compose logs -f --tail=100 logicc2api

# 更新源码并重建，继续使用原有数据卷
git pull --ff-only
docker compose up -d --build --wait

# 停止并移除容器，保留号池数据
docker compose down
```

只有确定要删除号池数据时，才给 `docker compose down` 添加 `--volumes` / `-v`。命名卷行为可参考 [Docker 数据卷文档](https://docs.docker.com/engine/storage/volumes/)。

部署在远程服务器时，可在自己的电脑上通过 SSH 隧道访问仅限本机的控制台：

```bash
ssh -N -L 18789:127.0.0.1:18789 your-user@your-server
```

然后在电脑上打开 `http://127.0.0.1:18789/`。如果修改了端口，请同步调整两处端口号。现有本机来源检查仍然生效；公网域名访问需要另行设计身份认证和访问控制。

### Docker 请求报 `fetch failed` / DNS 错误

容器显示 healthy 但请求失败时，先查看请求日志。网络错误会显示上游域名及已识别的错误代码；`EAI_AGAIN` / `ENOTFOUND` 表示域名解析失败。`/health` 成功只代表本地服务正在运行。

Docker Desktop 的 DNS 转发器可能在 IPv6（AAAA）查询上超时，而宿主机仍能正常解析。确认另一个 DNS 在容器中可用后，可创建**本机配置** `compose.override.yaml`，指定该 DNS。例如已验证 `223.5.5.5` 可用时：

```yaml
services:
  logicc2api:
    dns:
      - 223.5.5.5
```

执行 `docker compose up -d --wait` 应用配置。Compose 会自动加载此文件并保留原有数据卷。该文件已被 Git 忽略，其他部署继续使用自己的 DNS。仅凭 DNS 错误不能判断 Logicc 凭据失效。可参考 [Docker DNS 配置说明](https://docs.docker.com/desktop/features/networking/networking-how-tos/)。

## 账户凭据

添加账户时支持以下任一种组合：

| 输入 | 行为 |
| --- | --- |
| `__client` Cookie + Session ID | 按需获取新的 Session JWT |
| `__client` Cookie + Session JWT | 从 JWT 的 `sid` 中读取 Session ID，再按需刷新 |
| 仅 Session JWT | 有效期内可用；到期后手动替换，或通过 `/__set_token` 推送新 JWT |

在已登录 Logicc 的浏览器中，打开开发者工具 → Application → Cookies → `clerk.logicc.com`，复制 `__client` 的 **Value**。Session ID 以 `sess_` 开头。也可在 Logicc 页面的 Console 获取 Session JWT：

```js
await window.Clerk.session.getToken({ skipCache: true })
```

`__session` Cookie 保存的是短期 Session JWT，与 `__client` 不是同一种凭据。会话被注销、撤销等情况仍需更新凭据，自动刷新不代表永久有效。

编辑时留空的凭据字段会保留已有值。更换客户端 Cookie 或 Session ID 会清除旧 JWT 缓存。启停和移除仅作用于本地号池，不会删除上游账户。

### 批量导入

在 **批量导入** 中粘贴 JSON 数组或上传 JSON 文件：

```json
[
  {
    "name": "工作账户",
    "clientCookie": "YOUR_CLIENT_COOKIE",
    "sessionId": "sess_YOUR_SESSION_ID",
    "enabled": true
  }
]
```

也支持 `{ "accounts": [...] }`。仅使用 JWT 时，每项填写 `name` 和 `token`。号池最多 200 个账户，相同 Session ID 不重复导入；整批校验通过后保存，校验失败不会部分写入。

## API 调用

### 获取模型列表

```bash
curl http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer local'
```

模型列表从选中的上游账户获取，不在代码中固定。

### 非流式响应

```bash
curl http://127.0.0.1:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "用一句话打个招呼。"}]
  }'
```

### 流式响应

```bash
curl -N http://127.0.0.1:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{
    "model": "default",
    "stream": true,
    "stream_options": {"include_usage": true},
    "messages": [{"role": "user", "content": "用一句话打个招呼。"}]
  }'
```

`model` 省略或为 `default` 时，选择上游默认模型，没有默认项则使用第一个模型。流式返回 `chat.completion.chunk`，以 `[DONE]` 结束；省略 `stream` 或设为 `false` 则返回完整 JSON。

上游提供 token 用量时会转换返回；未提供时，API 兼容响应的计数填零，控制台明确显示用量不可用，不估算用量。

### Responses 协议

`POST /v1/responses` 接受字符串或消息数组形式的 `input`，支持 `instructions`、`reasoning.effort`、函数工具、`tool_choice` 和 `stream`。

```bash
curl http://127.0.0.1:18789/v1/responses \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{"model":"default","input":"用一句话介绍自己。","stream":true,"store":false}'
```

流式事件包括 `response.created`、`response.output_text.delta`、`response.function_call_arguments.delta` 和 `response.completed`；失败时发送 `response.failed`。函数调用出现在 `output` 中，类型为 `function_call`；客户端执行后，通过 `function_call_output` 和同一个 `call_id` 回传结果。Responses 的 `custom` 工具也可携带字符串输入，返回 `custom_tool_call`，并接收 `custom_tool_call_output`。

默认 `store: true` 会将 Response 和对话历史临时保存在**进程内存**，最多 30 分钟、128 条或 16 MiB，总量达到限制时淘汰旧项。可用 `previous_response_id` 继续对话，也支持 `GET /v1/responses/{id}` 和 `DELETE /v1/responses/{id}`。重启后缓存清空，缓存不写入号池文件；`store: false` 时不会缓存，客户端需要传完整历史。顶层 `instructions` 不会自动继承到下一次请求。

### Messages 协议

`POST /v1/messages` 支持 `system`、文本内容块、`tools[].input_schema`、`tool_choice`、`tool_use` 和 `tool_result`。配置了代理 API Key 时，可使用 `x-api-key` 或 Bearer 认证。

为兼容混合协议客户端，代理也接受 `messages` 内的 `system` / `developer` 角色、Chat 格式的 `assistant.tool_calls`，以及带 `tool_call_id` 的 `role: tool`。顶层 `system` 和消息中的指令会同时保留，角色与相对顺序不变；同时支持嵌套的 `tools[].function` 定义及 `tool_choice: {type: "function", function: {name: "..."}}`。响应继续使用 Messages 的 JSON/SSE 格式，包括 `tool_use` 内容块；`/v1/messages/count_tokens` 接受同样的输入。

工具结果仍须通过 ID 对应前面的 assistant 调用（`tool_use` 或 `tool_calls`）。缺少历史调用、缺少 ID 或重复提交结果时，仍返回 HTTP 400 和具体校验原因；代理不会补造工具历史。

```bash
curl http://127.0.0.1:18789/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: local' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"default","max_tokens":512,"stream":true,"messages":[{"role":"user","content":"用一句话介绍自己。"}]}'
```

使用 SDK 时，OpenAI 的 `baseURL` 填 `http://127.0.0.1:18789/v1`；Anthropic 的 `baseURL` 填 `http://127.0.0.1:18789`，不要重复添加 `/v1`。

流式响应使用 `message_start`、`content_block_start/delta/stop`、`message_delta` 和 `message_stop`。工具参数通过 `input_json_delta` 发送，结束原因为 `tool_use`。客户端执行工具后，将 `tool_result` 放入下一条 user 消息，并用 `tool_use_id` 对应原调用 ID。

`POST /v1/messages/count_tokens` 返回本地估算值，并附带 `X-Logicc-Token-Count: estimated`。该值用于客户端预估上下文大小，不是上游真实 tokenizer 结果，不应用于计费。

### 客户端工具调用

三种协议共用工具转换逻辑，保留调用 ID 和结果关联：

| 协议 | 工具定义 | 模型返回 | 客户端回传 |
| --- | --- | --- | --- |
| Chat Completions | `type: function` + `function` | `message.tool_calls`；`finish_reason: tool_calls` | `role: tool` + `tool_call_id` |
| Responses | `type: function` + 顶层 `name/parameters` | `output[].type: function_call` | `type: function_call_output` + `call_id` |
| Messages | `name` + `input_schema` | `content[].type: tool_use`；`stop_reason: tool_use` | `type: tool_result` + `tool_use_id` |

以 Chat Completions 为例，请求函数调用：

```json
{
  "model": "default",
  "messages": [{"role": "user", "content": "查询杭州现在的天气，请调用 get_weather。"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "由客户端查询指定城市的实时天气",
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

模型返回调用后，由**客户端**执行函数。下一次请求携带原用户消息、包含 `tool_calls` 的 assistant 消息，以及 `role: tool` 的结果消息；不要只发送工具结果，否则缺少上下文和调用 ID 关联。

支持 `auto`、`none`、`required` / Messages `any`、指定工具，以及禁止并行调用。`none` 不会把文本中的 JSON 解释成调用；强制调用未生成有效结果时明确返回错误，不会伪造一次成功调用。参数会检查 JSON 格式、已声明工具名、必填字段、基础类型、枚举和基础对象字段约束。

**实现边界：** Logicc 的当前聊天入口没有开放自定义函数注册，因此本适配器通过结构化提示让模型生成工具请求，再转换成标准协议。普通文本实时转发；带客户端工具的响应会先缓冲并校验 JSON，再发送协议事件。模型遵循程度会影响成功率，不提供原生约束解码、完整 JSON Schema `strict` 或自定义 grammar 的保证。适配器不会执行客户端的 shell、文件或网络工具。

### 上游内置工具与其他限制

- 要调用 Logicc 内置搜索或图片工具，使用 `tools: [{"type":"web_search"}]` 或 `[{"type":"image_generation"}]`；`web_search_preview` 也映射为内置搜索。控制台测试页已使用这种写法。
- **函数工具即使命名为 `web_search`，也会作为客户端函数返回，不再被替换成上游搜索。** 这是对旧版工具调用行为的修正。
- 已由上游执行的工具不会重复交给客户端执行；内置工具活动仍可作为文本标记出现在回答中。
- 每次请求仍新建上游聊天，多轮消息和工具结果会保留角色与 ID 后合并为提示词。
- `reasoning_effort` / Responses `reasoning.effort` 会透传；不提供跨供应商 reasoning / thinking 内容块。
- `max_tokens`、`max_completion_tokens`、`max_output_tokens` 作为输出长度提示，不是上游硬性 token 上限。`temperature` / `top_p` 不控制上游采样。
- 暂不支持附件、Responses JSON Schema 文本输出、后台任务、WebSocket、Conversations API 或完整 OpenAI / Anthropic API。图片工具输出在测试页面中以文本显示。

协议字段参考 [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)、[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events) 和 [Anthropic Messages 流式协议](https://platform.claude.com/docs/en/build-with-claude/streaming)。

## 上游助手提示词

打开控制台的 **开发者 → 助手提示词**，或直接访问 <http://127.0.0.1:18789/#prompts>。

1. 选择号池账号，从“我的助手库”“组织共享”或“官方模板”读取该账号能访问的助手。
2. 选择助手后，页面从 Logicc 助手接口读取真实 `systemPrompt`，并标明编辑权限。上游没有提供原文时会明确显示，不会生成替代原文。
3. `owner` / `editor` 可以编辑并“保存并发布”；其他权限只能查看。保存遵循上游的“读取/创建草稿 → 更新 systemPrompt → 发布 → 重新读取确认”流程，保留模型、工具、附件等其他设置。
4. 如果上游已经有未发布草稿，页面会展示该草稿并提示：发布会一并发布草稿中已有的改动。上游在读取后被其他人修改时，保存会返回冲突，需重新读取核对。
5. 需要时点击“设为代理默认助手”。此后，分配到该账号的新代理请求会在创建上游聊天时携带助手 ID；Chat Completions、Responses 和 Messages 均适用。请求未指定模型或使用 `default` 时优先使用所选助手的模型；显式传入的模型仍由请求决定。“取消默认”恢复普通聊天。

没有助手时，可以在页面新建私有助手。新助手默认关闭上游网页搜索和图片生成，避免额外工具行为；以后可在 Logicc 网站配置这些能力。

提示词副本与默认助手选择独立保存在数据目录的 `assistant-prompts.json` 中，与账号凭据文件分开。保留最近读取的最多 200 个助手快照；每个快照保存首次读取原文和最近读取内容。文件权限为 `0600`，Docker 数据卷会保留这些配置，不会上传 Git。点击“将备份载入编辑器”只修改编辑区，仍需点击保存才会发布到上游。

这里编辑的是**上游助手指令**，不是 Logicc 平台隐藏的内置系统提示词。平台内置提示词目前未取得可验证原文，也未发现修改入口。助手自定义指令的具体遵循程度仍取决于上游平台和模型。

## 调度与刷新行为

- 从已启用、符合调度条件的账户中，优先选择正在处理请求数最少的账户；同等并发采用轮询。同一次聊天固定使用一个账户。
- HTTP 429 冷却 60 秒，401 / 403 冷却 5 分钟，上游服务错误冷却 15 秒。后续请求跳过冷却账户。
- 冷却结束后，符合条件的账户可参与下一次请求；也可主动检测或更新账户。失败的单次请求不会跨账户重放。
- JWT 剩余寿命少于 10 秒时按需刷新；上游返回 401 时强制刷新并重试一次。
- 同一账户的并发刷新会合并；Clerk 返回新 `__client` Cookie 时自动保存。
- Clerk 刷新端点为 `POST /v1/client/sessions/{sid}/tokens`。

## 配置与数据

| 环境变量 | 用途 |
| --- | --- |
| `PORT` | 监听端口，默认 `18789` |
| `LOGICC_HOST` | 监听地址；Node.js 直接启动默认 `127.0.0.1`，容器内默认 `0.0.0.0` |
| `LOGICC_DATA_FILE` | 数据文件路径，默认项目目录下 `data/state.json` |
| `LOGICC_API_KEY` | 可选，配置后 `/v1/*` 必须携带对应 Bearer Key |
| `LOGICC_API_BASE` | 上游基址，默认 `https://app.logicc.com/api` |
| `LOGICC_CLERK_BASE` | Clerk 基址，默认 `https://clerk.logicc.com` |
| `LOGICC_CLIENT_COOKIE` | 号池为空时导入默认账户 |
| `LOGICC_SESSION_ID` | 环境变量导入账户的 Session ID，也可从 JWT 中读取 |
| `LOGICC_TOKEN` | 环境变量导入账户的初始 JWT |
| `LOGICC_TOKEN_FILE` | 环境变量导入账户使用的外部 JWT 文件 |
| `LOGICC_TOKEN_CMD` | 该账户的外部 JWT 刷新命令，仅从进程环境读取，页面不可配置 |

直接使用 Node.js 启动时，程序不自动加载 `.env` 文件。请在 shell 中导出环境变量，或在支持的 Node.js 版本中使用 `node --env-file=.env server.mjs` 启动。Docker Compose 会读取 `.env` 并映射上文的 `LOGICC_PORT` 和 `LOGICC_API_KEY`；`LOGICC_PORT` 仅用于 Compose，不是 Node.js 服务直接读取的变量。如需其他环境变量，应显式添加到 Compose 服务配置中。

已有账户数据优先于初始环境凭据，避免旧环境变量覆盖已轮换的 Cookie。使用外部刷新命令或 JWT 文件的账户，重启时仍需提供相应配置。

`data/state.json` 保存账户凭据、缓存模型目录、冷却时间及最多 2,000 条请求元数据。采用临时文件写入后重命名，文件请求权限为 `0600`；其中凭据为 **明文**，权限保护效果取决于操作系统。运行数据、环境文件、日志、备份和浏览器测试产物均排除在 Git 之外。

看板统计保留记录中最近 24 小时的聊天请求。模型同步与账号检测显示在日志中，不计入聊天指标。日志页展示最近 200 条记录。首字延迟包含凭据刷新、建立聊天和网络传输耗时；请求日志不保存提示词与生成的回答。

**Node/Docker 控制台**面向单进程本机使用，没有单独的管理员登录系统。管理请求需要通过本机来源/Host 检查并带有 `X-Logicc-Admin: 1`；`LOGICC_API_KEY` 仅保护 `/v1/*`，不保护本机控制台。本机兼容入口 `POST /__set_token` 接收原始 JWT，可附加 `?account_id=<id>`，允许 Logicc 页面来源访问，并按 JWT 的 Session ID 匹配账户。Workers 使用前文所述的独立密码和持久化存储。

不要让多个实例同时写入同一数据文件。独立实例请分别配置端口和 `LOGICC_DATA_FILE`。

### 防止 Logicc 凭据提交到 Git

`.gitignore` 已排除账号状态、助手快照、`.env*`、`.dev.vars*`、账号与凭据导出、Token/Cookie 文本文件、私钥、浏览器登录状态、HAR/PCAP 抓包、备份和 Wrangler 本地数据。环境文件仅允许提交空值或示例模板。Docker 使用明确的源码白名单；Workers 静态资源限定为 `public/`。

发布前执行 `npm run check:secrets`，仅报告可疑文件名和行号，不输出凭据值。这项检查针对常见格式，不能保证识别所有秘密信息。若真实凭据已被公开，忽略规则不会删除 Git 历史；需要撤销对应 Logicc 会话，并从当前文件及历史中移除暴露内容。

GitHub Actions 在推送和 Pull Request 时自动执行凭据检查、协议测试、Workers 集成测试与部署构建检查。

## 开发与验证

```bash
npm test
```

使用 Node 内置测试框架和本机模拟上游，覆盖账户增删改与整批导入、凭据脱敏和文件权限、轮询与冷却、强制刷新与 Cookie 轮换、并发刷新合并、JSON/SSE 转换、三种协议的工具调用与结果回传、用量与错误统计、来源限制和异常输入。测试无需真实凭据，不消耗上游额度。

```text
server.mjs              HTTP 路由、上游调用和 Responses 临时缓存
protocols.mjs           三种协议的请求、工具调用与 JSON / SSE 转换
assistants.mjs          上游助手草稿发布、独立提示词备份与默认助手配置
pool.mjs                账户存储、凭据刷新、调度和统计
public/                 无需构建的 Web 控制台
test/adapter.test.mjs    集成与协议测试
Dockerfile              非 root 容器镜像和健康检查
compose.yaml            本机端口映射与号池数据持久化
worker.mjs              Workers 鉴权入口与持久化号池存储
wrangler.jsonc          静态资源、Secrets 与自动 Durable Object 迁移
test/worker.integration.mjs  本地 Workers 运行时集成检查
```

## 许可证

[MIT](LICENSE) © 2026 JamesZhaoY。
