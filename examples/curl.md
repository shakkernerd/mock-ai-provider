# curl

```sh
npx mock-ai-provider serve --providers openai
```

```sh
# Models
curl http://127.0.0.1:31337/v1/models -H 'Authorization: Bearer local'

# Chat
curl http://127.0.0.1:31337/v1/chat/completions \
  -H 'Authorization: Bearer local' -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}'

# Responses
curl http://127.0.0.1:31337/v1/responses \
  -H 'Authorization: Bearer local' -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5.5","input":"hi"}'

# Embeddings
curl http://127.0.0.1:31337/v1/embeddings \
  -H 'Authorization: Bearer local' -H 'Content-Type: application/json' \
  -d '{"model":"text-embedding-3-small","input":"hi","dimensions":8}'
```
