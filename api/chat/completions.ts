import { notEmpty } from "openapi-util";
import {
  ContentBlock,
  ContentBlockStartEvent,
  CreateMessageRequest,
  CreateMessageResponse,
  InputJsonDelta,
  Message as AnthropicMessage,
  MessageDeltaEvent,
  MessageStartEvent,
  MessageStopEvent,
  StreamResponseEvent,
  SystemPrompt,
  TextDelta,
  Tool as AnthropicTool,
  ToolChoice,
  ContentBlockDeltaEvent,
} from "../../src/anthropic-types.js";
import {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ContentPart,
  Tool as ChatCompletionTool,
  Message as ChatCompletionMessage,
  ChatCompletionResponse,
  ChatCompletionChoice,
  ToolCall,
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
  const openapi = await fetch(new URL(req.url).origin + "/openapi.json").then(
    (res) => res.json(),
  );
  const baseUrl = openapi["x-origin-servers"][0].url;

  const input: ChatCompletionRequest = await req.json();
  const headers = new Headers({
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": req.headers.get("authorization")?.split(" ")[1] || "",
  });

  const system = input.messages.find((x) => x.role === "system")?.content;

  const anthropicMessages: AnthropicMessage[] = input.messages
    .filter((x) => x.role !== "system")
    .map((item) => {
      if (item.role === "function") {
        // deprecated
        return;
      }
      if (item.role === "system") {
        //already filtered out
        return;
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

  const anthropicTools: AnthropicTool[] | undefined = input.tools
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
    input.tool_choice === "auto"
      ? { type: "auto" }
      : input.tool_choice === "none"
        ? undefined
        : input.tool_choice?.type === "function"
          ? { type: "tool", name: input.tool_choice.function.name }
          : undefined;

  const anthropicSystem: SystemPrompt[] =
    typeof system === "string"
      ? [{ text: system, type: "text", cache_control: { type: "ephemeral" } }]
      : [
          {
            type: "text",
            cache_control: { type: "ephemeral" },
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
    headers: { "Content-Type": "text/event-stream" },
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
    system_fingerprint: null,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: data.message.model,
    choices: [
      {
        logprobs: null,
        index: 0,
        delta: {
          role: "assistant",
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
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        logprobs: null,
        delta: {
          role: "assistant",
          content: "",
          tool_calls:
            data.content_block.type === "tool_use"
              ? [
                  {
                    type: "function",
                    id: data.content_block.id,
                    function: {
                      name: data.content_block.name,
                      arguments: JSON.stringify(data.content_block.input),
                    },
                  } satisfies ToolCall,
                ]
              : undefined,
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
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        logprobs: null,
        delta: {
          role: "assistant",
          content:
            data.delta.type === "text_delta" ? data.delta.text : undefined,
          tool_calls:
            data.delta.type === "input_json_delta"
              ? [
                  {
                    function: { arguments: data.delta.partial_json, name: "" },
                    type: "function",
                    id: "",
                  } satisfies ToolCall,
                ]
              : undefined,
        },
        finish_reason: null,
      },
    ],
  };
  return chunk;
}

function transformMessageDelta(data: MessageDeltaEvent, model: string) {
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        logprobs: null,
        finish_reason: data.delta.stop_reason,
      },
    ],
  };
  return chunk;
}

function transformMessageStop(data: MessageStopEvent, model: string) {
  const chunk: ChatCompletionChunk = {
    id: String(Date.now()),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,

        delta: { role: "assistant" },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
  };
  return chunk;
}
