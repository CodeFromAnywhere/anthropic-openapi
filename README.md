OpenAPIs

- [Chat Completion OpenAPI](public/operations/createChatCompletion.json)
- [Messages OpenAPI](public/operations/createMessage.json)
- [Combined OpenAPI](public/openapi.json)

Requirements:

- `createMessage` proxies Anthropic functionality 1:1
- `createChatCompletion` proxies Anthropic functionality 1:1, but using the Chat Completions protocol
- There is no restriction on client origin, allowing direct usage from the browser.
