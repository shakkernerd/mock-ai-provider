# OpenAI Python SDK

```sh
npx mock-ai-provider serve --providers openai
```

```py
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:31337/v1", api_key="local")

# Chat
chat = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "hi"}],
)
print(chat.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "hi"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
print()

# Responses API
r = client.responses.create(model="gpt-5.5", input="hi")
print(r.output_text)
```
