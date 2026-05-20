# OpenAI Node SDK

```sh
npx mock-ai-provider serve --providers openai
```

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:31337/v1",
  apiKey: "local"
});

// Chat
const chat = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "hi" }]
});
console.log(chat.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "hi" }],
  stream: true
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
}

// Responses API
const r = await client.responses.create({ model: "gpt-5.5", input: "hi" });
console.log(r.output_text);
```
