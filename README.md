Claude API Streaming with client-origin allowed and <a href="openapi.json">OpenAPI spec</a> and <a href="chat-completions.json">Chat Completions OpenAPI Spec</a>

Instructions:

```md
Make me a HTML + Tailwind website using fetch to stream a user prompt to the Claude api and show the response, streamed, in a textarea. also log the delta in console.

The user request should be embedded in this prompt:

Make me a vanilla HTML + TailwindCDN + CSS + JS website with the following requirements:

- everything is always stored as much as possible in localStorage and editable in settings, including required api keys
- for icons, use font awesome

{userPrompt}

This prompt is stored in localStorage and also updatable by the user.
```
