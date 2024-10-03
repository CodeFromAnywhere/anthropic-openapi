import { notEmpty, tryParseJson } from "openapi-util";
import {
  ContentBlock,
  ContentBlockStartEvent,
  CreateMessageRequest,
  CreateMessageResponse,
  AnthropicMessage,
  MessageDeltaEvent,
  MessageStartEvent,
  MessageStopEvent,
  StreamResponseEvent,
  SystemPrompt,
  Tool as AnthropicTool,
  ToolChoice,
  ContentBlockDeltaEvent,
} from "../../src/anthropic-types.js";

import {
  ChatCompletionRequest,
  ContentPart,
  ChatCompletionResponse,
  ChatCompletionChoice,
  ToolCall,
  ChatCompletionChunk,
  FullToolCallDelta,
  PartialToolCallDelta,
} from "../../src/openai-types.js";
/** needed for image support anthropic */
const urlToBase64 = (url?: string) => undefined;

const parseContentParts = (parts: ContentPart[] | null | undefined) => {
  if (!parts) {
    return "";
  }
  const strings = parts.reduce((res, part) => {
    if (part.type === "text") {
      return res.concat(part.text!);
    }
    if (part.type === "image_url" && part.image_url) {
      return res.concat(
        `![resolution:${part.image_url.detail}](${part.image_url.url})`,
      );
    }
    return res;
  }, [] as string[]);

  return strings.join("\n\n");
};

export const POST = async (req: Request) => {
  const baseUrl = "https://api.anthropic.com/v1";
  const anthropicVersion = "2023-06-01";
  const apiKey = req.headers.get("authorization")?.split(" ")[1] || "";
  const headersJson = {
    "Content-Type": "application/json",
    "anthropic-version": anthropicVersion,
    "x-api-key": apiKey,
  };
  console.log("headers", headersJson);
  const input: ChatCompletionRequest = await req.json();
  const headers = new Headers(headersJson);

  const system = input.messages.find((x) => x.role === "system")?.content;

  const anthropicMessages: AnthropicMessage[] = input.messages
    .filter((x) => x.role !== "system")
    .map((item) => {
      if (item.role === "function") {
        // deprecated
        return;
      }
      // if (item.role === "system") {
      //   //already filtered out
      //   return;
      // }

      if (item.role === "assistant" && item.tool_calls) {
        // NB: assuming a single tool
        const message: AnthropicMessage = {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: item.tool_calls[0].function.name,
              id: item.tool_calls[0].id,
              input: tryParseJson(item.tool_calls[0].function.arguments) || {},
            },
          ],
        };
        console.log("tool calls message", message);
        return message;
      }

      if (item.role === "tool") {
        const message: AnthropicMessage = {
          role: "user",
          content: [
            {
              tool_use_id: item.tool_call_id,
              type: "tool_result",
              is_error: false,
              content: item.content,
            },
          ],
        };
        return message;
      }

      const role = item.role;

      if (typeof item.content === "string") {
        return { content: item.content, role };
      }

      const content: ContentBlock[] =
        item.content
          ?.map((item) => {
            if (item.type === "image_url") {
              const data = urlToBase64(item.text);
              const contentBlock: ContentBlock = {
                type: "image",
                source: {
                  type: "base64",
                  data: data as unknown as string,
                  media_type: "image/webp",
                },
              };
              return contentBlock;
            }

            if (item.type === "text" && item.text) {
              return { type: "text", text: item.text } satisfies ContentBlock;
            }

            return;
          })
          .filter(notEmpty) || [];

      const message: AnthropicMessage = {
        role,
        content,
      };

      return message;
    })
    .filter(notEmpty);

  const anthropicTools: AnthropicTool[] | undefined =
    input.tool_choice === "none"
      ? undefined
      : input.tools
          ?.map((item) => {
            if (item.type !== "function") {
              // not supported
              return;
            }
            const anthropicTool: AnthropicTool = {
              name: item.function.name,
              description: item.function.description,
              input_schema: item.function.parameters || { type: "object" },
            };
            return anthropicTool;
          })
          .filter(notEmpty);

  const anthropicToolChoice: ToolChoice | undefined =
    input.tool_choice === "none"
      ? undefined
      : (input.tools && !input.tool_choice) || input.tool_choice === "auto"
        ? { type: "auto" }
        : input.tool_choice?.type === "function"
          ? { type: "tool", name: input.tool_choice.function.name }
          : undefined;

  const anthropicSystem: SystemPrompt[] =
    typeof system === "string"
      ? [
          {
            text: system,
            type: "text",
            //  cache_control: null, //{ type: "ephemeral" }
          },
        ]
      : [
          {
            type: "text",
            // cache_control: null, //{ type: "ephemeral" },
            text: parseContentParts(system),
          },
        ];

  const anthropicBody: CreateMessageRequest = {
    // needs no alteration
    model: input.model,
    stream: input.stream,
    temperature: input.temperature,
    top_p: input.top_p,

    // needs alteration
    max_tokens: input.max_tokens || 4096,
    stop_sequences:
      typeof input.stop === "string" ? [input.stop] : input.stop || undefined,
    system: anthropicSystem,
    messages: anthropicMessages,
    tool_choice: anthropicToolChoice,
    tools: anthropicTools,

    // not possible with chat completions:
    metadata: undefined,
    top_k: undefined,
  };

  console.log("body", anthropicBody);

  const result = await fetch(baseUrl + "/messages", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(anthropicBody),
  });

  if (!result.ok) {
    const text = await result.text();
    return new Response(text, {
      status: result.status,
      statusText: result.statusText,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (!input.stream) {
    const anthropicResponse = await result.json();
    const openAIResponse = transformAnthropicToOpenAI(anthropicResponse);
    return new Response(JSON.stringify(openAIResponse), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = result.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              console.log("line", line);
              const data: StreamResponseEvent = JSON.parse(line.slice(6));

              if (data.type === "message_start") {
                controller.enqueue(
                  `data: ${JSON.stringify(transformMessageStart(data))}\n\n`,
                );
              } else if (data.type === "content_block_start") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformContentBlockStart(data, input.model),
                  )}\n\n`,
                );
              } else if (data.type === "content_block_delta") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformContentBlockDelta(data, input.model),
                  )}\n\n`,
                );
              } else if (data.type === "message_delta") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformMessageDelta(data, input.model),
                  )}\n\n`,
                );
              } else if (data.type === "message_stop") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformMessageStop(data, input.model),
                  )}\n\n`,
                );
                controller.enqueue("data: [DONE]\n\n");
              } else if (data.type === "content_block_stop") {
                //todo
              } else if (data.type === "error") {
                //todo
              } else if (data.type === "ping") {
                //todo
              }
            } else if (line.startsWith("event: ")) {
              // console.log(line);
            } else if (line !== "") {
              console.log(`weird line:`, line);
            }
          }
        }
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

function transformAnthropicToOpenAI(anthropicResponse: CreateMessageResponse) {
  const completionResponse: ChatCompletionResponse = {
    id: anthropicResponse.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model,
    system_fingerprint: "",
    choices: anthropicResponse.content.map((item) => {
      const mapper = {
        end_turn: "stop",
        max_tokens: "length",
        stop_sequence: "stop",
        tool_use: "tool_calls",
      } as const;

      const finish_reason: ChatCompletionChoice["finish_reason"] =
        anthropicResponse.stop_reason
          ? mapper[anthropicResponse.stop_reason]
          : "stop";

      const tool_calls: ToolCall[] | undefined =
        item.type === "tool_use"
          ? [
              {
                type: "function",
                id: item.id,
                function: {
                  name: item.name,
                  arguments: JSON.stringify(item.input),
                },
              },
            ]
          : undefined;

      const choice: ChatCompletionChoice = {
        index: 0,
        logprobs: null,
        finish_reason,
        message: {
          role: "assistant",
          tool_calls,
          content: item.type === "text" ? item.text : null,
        },
      };
      return choice;
    }),

    usage: {
      prompt_tokens: anthropicResponse.usage.input_tokens,
      completion_tokens: anthropicResponse.usage.output_tokens,
      total_tokens:
        anthropicResponse.usage.input_tokens +
        anthropicResponse.usage.output_tokens,
    },
  };

  return completionResponse;
}

function transformMessageStart(data: MessageStartEvent) {
  const chunk: ChatCompletionChunk = {
    id: data.message.id,
    system_fingerprint: "",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: data.message.model,
    choices: [
      {
        logprobs: null,
        index: 0,
        delta: {
          role: "assistant",
          content: "",
        },
        finish_reason: null,
      },
    ],
  };
  return chunk;
}

function transformContentBlockStart(
  data: ContentBlockStartEvent,
  model: string,
) {
  const tool_calls: FullToolCallDelta[] | undefined =
    data.content_block.type === "tool_use"
      ? [
          {
            index: 0,
            type: "function",
            id: data.content_block.id,
            function: {
              name: data.content_block.name,
              arguments:
                // NB: At anthropic, this is given at tool-start. Shouldn't be used!
                JSON.stringify(data.content_block.input) === "{}"
                  ? ""
                  : JSON.stringify(data.content_block.input),
            },
          },
        ]
      : undefined;
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model,
    system_fingerprint: "",
    choices: [
      {
        index: 0,
        logprobs: null,
        delta: {
          role: "assistant",
          tool_calls,
        },
        finish_reason: null,
      },
    ],
  };
  return chunk;
}

function transformContentBlockDelta(
  data: ContentBlockDeltaEvent,
  model: string,
) {
  const tool_calls: PartialToolCallDelta[] | undefined =
    data.delta.type === "input_json_delta"
      ? [
          {
            index: 0,
            function: { arguments: data.delta.partial_json },
            type: undefined,
            id: undefined,
          },
        ]
      : undefined;

  const firstChoice: ChatCompletionChunk["choices"][number] = {
    index: 0,
    logprobs: null,
    delta: {
      role: "assistant",
      content: data.delta.type === "text_delta" ? data.delta.text : undefined,
      tool_calls,
    },
    finish_reason: null,
  };
  console.log("first", tool_calls);

  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "",
    choices: [firstChoice],
  };
  return chunk;
}

function transformMessageDelta(data: MessageDeltaEvent, model: string) {
  console.log(`doing nothing with DATA messagedelta`, data);
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        logprobs: null,
        finish_reason: null,
      },
    ],
  };
  return chunk;
}

function transformMessageStop(data: MessageStopEvent, model: string) {
  console.log(`doing nothing with data messagestop:`, data);
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        logprobs: null,
        finish_reason: null,
      },
    ],
  };
  return chunk;
}
