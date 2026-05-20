# OpenClaw provider config example

Use `mock-ai-provider` anywhere OpenClaw accepts an OpenAI-compatible provider
base URL.

```sh
npx mock-ai-provider serve --providers openai
```

Provider values:

```text
provider: openai-compatible or openai
baseURL: http://127.0.0.1:31337/v1
apiKey: local-test-key
model: gpt-5.5
```

The exact OpenClaw config key names depend on the OpenClaw runtime/config layer
you are using. The important part is that OpenClaw should call the normal
OpenAI-compatible HTTP API at:

```text
http://127.0.0.1:31337/v1
```

Expected behavior:

- OpenClaw sends normal provider requests.
- The mock server returns deterministic OpenAI-shaped responses.
- `.mock-ai-provider/requests.jsonl` shows the full parsed request bodies and
  response summaries.
