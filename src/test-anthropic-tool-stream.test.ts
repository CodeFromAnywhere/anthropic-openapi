import {
  ContentBlockDeltaEvent,
  CreateMessageRequest,
  MessageDeltaEvent,
  StreamEvent,
} from "./anthropic-types";

const API_KEY = process.env.ANTHROPIC_TOKEN!;
const API_VERSION = "2023-06-01";

async function testAnthropicAPI() {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            "What's the weather in amsterdam? use the weather tool to check",
        },
      ],
      stream: true,
      tools: [
        {
          name: "get_current_weather",
          description: "Get the current weather in a given location",
          input_schema: {
            type: "object",
            properties: {
              location: { type: "string" },
              unit: { type: "string", enum: ["celsius", "fahrenheit"] },
            },
            required: ["location"],
          },
        },
      ],
      tool_choice: { type: "auto" },
    } satisfies CreateMessageRequest),
  });

  if (!response.ok) {
    console.error(`HTTP error! status: ${response.status}`);
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullResponse = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          console.log("Stream finished");
          break;
        }

        try {
          const event: any = JSON.parse(data);
          switch (event.type) {
            case "message_start":
              console.log("Message started");
              break;
            case "content_block_start":
              console.log(`Content block ${event.index} started`);
              break;
            case "content_block_delta":
              const deltaEvent: ContentBlockDeltaEvent = event;
              if (deltaEvent.delta?.type === "text_delta") {
                process.stdout.write(event.delta.text || "");
                fullResponse += event.delta.text || "";
              } else if (deltaEvent.delta.type === "input_json_delta") {
                process.stdout.write(deltaEvent.delta.partial_json || "");
                fullResponse += deltaEvent.delta.partial_json || "";
              }
              break;
            case "content_block_stop":
              console.log(`\nContent block ${event.index} stopped`);
              break;
            case "message_delta":
              if (event.delta?.type === "tool_use") {
                console.log("\nTool use detected");
              }
              break;
            case "message_stop":
              console.log("\nMessage stopped");
              break;
          }
        } catch (error) {
          console.error("Error parsing event:", error);
        }
      }
    }
  }

  console.log("\nFull response:");
  console.log(fullResponse);
}

testAnthropicAPI().catch(console.error);
