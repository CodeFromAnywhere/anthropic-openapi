import { CreateMessageRequest } from "./anthropic-types";

const API_KEY = process.env.ANTHROPIC_TOKEN;
const API_URL = "https://api.anthropic.com/v1/messages";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

const weatherTool: AnthropicTool = {
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
};

async function testAnthropicAPI() {
  const messages: AnthropicMessage[] = [
    {
      role: "user",
      content:
        "What's the weather like in New York? And how should I dress for it?",
    },
  ];

  const requestBody: CreateMessageRequest = {
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 1024,
    messages,
    stream: false,
    tools: [weatherTool],
    tool_choice: { type: "auto" },
  };

  try {
    console.log("Sending request to Anthropic API...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.log({ API_KEY, txt: response.statusText });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: AnthropicResponse = await response.json();
    console.log("Response received:");
    console.log("Message ID:", data.id);
    console.log("Model used:", data.model);
    console.log("Stop reason:", data.stop_reason);
    console.log("Usage:", data.usage);
    console.log("Content:");
    data.content.forEach((block, index) => {
      if (block.type === "text") {
        console.log(`Block ${index + 1}:`, block.text);
      } else {
        console.log(`Block ${index + 1}:`, block);
      }
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the test
testAnthropicAPI();
