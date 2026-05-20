# OpenClaw provider config

Point any OpenClaw OpenAI-compatible provider at the mock server.

```sh
npx mock-ai-provider serve --providers openai
```

```json5
{
  models: {
    providers: {
      mockai: {
        baseUrl: "http://127.0.0.1:31337/v1",
        apiKey: "local",
        api: "openai-completions",
        request: { allowPrivateNetwork: true },
        models: [
          {
            id: "gpt-5.5",
            name: "Mock GPT-5.5",
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
      models: { "mockai/gpt-5.5": {} }
    }
  }
}
```

OpenClaw sends normal provider requests; the mock returns deterministic OpenAI-shaped responses and logs each call to `.mock-ai-provider/requests.jsonl`.
