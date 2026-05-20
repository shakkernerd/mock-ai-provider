# OpenAI Python SDK example

Use the normal OpenAI Python SDK and replace only the base URL.

Start the server:

```sh
npx mock-ai-provider serve --providers openai
```

Install the SDK in your app:

```sh
pip install openai
```

Example:

```py
from openai import OpenAI

client = OpenAI(
    api_key="local-test-key",
    base_url="http://127.0.0.1:31337/v1",
)

chat = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "Say hello from the OpenAI Python SDK."}],
)

print(chat.choices[0].message.content)
```

Streaming:

```py
stream = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "Stream hello."}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
print()
```

Responses:

```py
response = client.responses.create(
    model="gpt-5.5",
    input="Say hello from Responses.",
)

print(response.output_text)
```
