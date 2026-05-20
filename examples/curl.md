# curl examples

Start the server:

```sh
npx mock-ai-provider serve --providers openai
```

List models:

```sh
curl http://127.0.0.1:31337/v1/models \
  -H 'Authorization: Bearer local-test-key'
```

Chat Completions:

```sh
curl http://127.0.0.1:31337/v1/chat/completions \
  -H 'Authorization: Bearer local-test-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      { "role": "user", "content": "Say hello from curl." }
    ]
  }'
```

Responses:

```sh
curl http://127.0.0.1:31337/v1/responses \
  -H 'Authorization: Bearer local-test-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-5.5",
    "input": "Say hello from Responses."
  }'
```

Embeddings:

```sh
curl http://127.0.0.1:31337/v1/embeddings \
  -H 'Authorization: Bearer local-test-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "text-embedding-3-small",
    "input": "local embedding text",
    "dimensions": 8
  }'
```
