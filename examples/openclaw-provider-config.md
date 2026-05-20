# OpenClaw provider config example

Use `mock-ai-provider` anywhere OpenClaw accepts an OpenAI-compatible provider
base URL.

```sh
npx mock-ai-provider serve --providers openai
```

Provider values:

```text
provider id: mockai
api: openai-completions
baseUrl: http://127.0.0.1:31337/v1
apiKey: local-test-key
model ref: mockai/gpt-5.5
```

Example OpenClaw config patch:

```json5
{
  models: {
    providers: {
      mockai: {
        baseUrl: "http://127.0.0.1:31337/v1",
        apiKey: "local-test-key",
        api: "openai-completions",
        request: { allowPrivateNetwork: true },
        models: [
          {
            id: "gpt-5.5",
            name: "Mock GPT-5.5",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192
          }
        ]
      }
    }
  },
  agents: {
    defaults: {
      model: { primary: "mockai/gpt-5.5" },
      models: {
        "mockai/gpt-5.5": {}
      }
    }
  }
}
```

Expected behavior:

- OpenClaw sends normal provider requests.
- The mock server returns deterministic OpenAI-shaped responses.
- `.mock-ai-provider/requests.jsonl` shows the full parsed request bodies and
  response summaries.
