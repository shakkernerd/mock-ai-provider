# OpenAI Node SDK example

Use the normal OpenAI Node SDK and replace only the base URL.

Start the server:

```sh
npx mock-ai-provider serve --providers openai
```

Install the SDK in your app:

```sh
npm install openai
```

Example:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "local-test-key",
  baseURL: "http://127.0.0.1:31337/v1"
});

const chat = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "Say hello from the OpenAI Node SDK." }]
});

console.log(chat.choices[0]?.message.content);
```

Streaming:

```js
const stream = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "Stream hello." }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
}
```

Responses:

```js
const response = await client.responses.create({
  model: "gpt-5.5",
  input: "Say hello from Responses."
});

console.log(response.output_text);
```
