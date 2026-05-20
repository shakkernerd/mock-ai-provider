# mock-ai-provider

Provider-compatible mock servers for OpenAI, Anthropic, and other AI APIs.

`mock-ai-provider` is a standalone local HTTP server. Your app should not need
mock-specific code: point its normal OpenAI base URL at the local server, keep a
normal API key value, and inspect deterministic requests and responses locally.

## Install

```sh
npm install -D mock-ai-provider
```

## Start

```sh
npx mock-ai-provider serve --providers openai
```

Default server:

```text
http://127.0.0.1:31337
```

Default OpenAI-compatible base URL for SDKs:

```text
http://127.0.0.1:31337/v1
```

Default request journal:

```text
.mock-ai-provider/requests.jsonl
```

## Base URLs

Single-provider OpenAI mode exposes native OpenAI paths:

```text
http://127.0.0.1:31337/v1
```

Provider-prefixed OpenAI mode is also available:

```text
http://127.0.0.1:31337/openai/v1
```

Use the native `/v1` base URL for most OpenAI SDKs.

## OpenAI Surface

The minimum v1 OpenAI-compatible surface includes:

- Models
- Chat Completions, including streaming and tool calls
- Responses, including streaming, tool calls, stored retrieval, input items, cancel, and delete
- Completions
- Embeddings
- Images
- Audio speech, transcriptions, and translations
- Videos
- Files
- Uploads
- Batches
- Vector stores, vector store files, and vector store file batches
- Moderations
- Fine-tuning job lifecycle routes

The server returns OpenAI-shaped JSON bodies, OpenAI-style error bodies, SSE
streaming responses, request ids, OpenAI metadata headers, permissive local auth
by default, and optional strict bearer-token auth.

## Request Journal

Every provider request is appended as one JSONL row. The journal includes the
full parsed request body for JSON requests, useful request and response headers,
status, provider, API surface, model, script step, response body or response
summary, emitted tool calls, and emitted final text.

Binary upload bodies are summarized with filename, content type, and byte
length instead of storing raw binary in the journal.

```sh
tail -f .mock-ai-provider/requests.jsonl
```

## CLI

```sh
mock-ai-provider serve \
  --providers openai \
  --port 31337 \
  --request-log .mock-ai-provider/requests.jsonl
```

Options:

- `--providers openai`: enabled provider protocols.
- `--script <path>`: scripted response file.
- `--models <path>`: model catalog override.
- `--port <number|0>`: server port. `0` asks the OS for a free port.
- `--request-log <path>`: JSONL request journal path.
- `--strict-auth`: require bearer auth.
- `--api-key <key>`: accepted bearer token when strict auth is enabled.

## Script Example

```json
{
  "id": "local-agent-flow",
  "steps": [
    {
      "id": "tool-call",
      "match": { "apiSurface": "chat.completions" },
      "respond": {
        "type": "tool-calls",
        "toolCalls": [
          {
            "name": "lookup_order",
            "arguments": "{\"order_id\":\"123\"}"
          }
        ]
      }
    },
    {
      "id": "final-after-tool",
      "match": {
        "apiSurface": "chat.completions",
        "hasToolResult": true
      },
      "respond": {
        "type": "final-text",
        "text": "The order is ready."
      }
    }
  ]
}
```

Start with the script:

```sh
npx mock-ai-provider serve --providers openai --script ./mock-script.json
```

## Examples

Examples live in `examples/`:

- `examples/curl.md`
- `examples/openai-node.md`
- `examples/openai-python.md`
- `examples/openclaw-provider-config.md`

## Development

```sh
pnpm install
pnpm run check
pnpm run serve
```

The package has no runtime dependencies.
