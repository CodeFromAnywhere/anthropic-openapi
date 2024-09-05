import { ChatCompletionRequest } from "./openai-types";

const API_KEY = process.env.ANTHROPIC_TOKEN!;
const API_URL = "http://localhost:3000/chat/completions";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

async function testAnthropicAPI() {
  const requestBody: ChatCompletionRequest = {
    model: "claude-3-5-sonnet-20240620",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content:
          "What's the weather like today in Amsterdam? Use the weather tool to check.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "geat_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
              unit: { type: "string", enum: ["celsius", "fahrenheit"] },
            },
            required: ["location"],
          },
        },
      },
    ],
    stream: true,
    max_tokens: 1000,
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      console.log({
        text,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonData = line.slice(6);
          if (jsonData.trim() === "[DONE]") {
            console.log("Stream finished");
          } else {
            try {
              const parsedData = JSON.parse(jsonData);
              const content = parsedData.choices[0]?.delta?.content || "";
              fullResponse += content;
              console.log("Received chunk:", content);

              if (parsedData.choices[0]?.delta?.tool_calls) {
                console.log(
                  "Tool call:",
                  JSON.stringify(
                    parsedData.choices[0].delta.tool_calls,
                    null,
                    2,
                  ),
                );
              }
            } catch (error) {
              console.error("Error parsing JSON:", error);
            }
          }
        }
      }
    }

    console.log("Full response:", fullResponse);
  } catch (error) {
    console.error("Error:", error);
  }
}

testAnthropicAPI();
