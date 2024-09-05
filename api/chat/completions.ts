// Base interface for all events
interface BaseEvent {
  type: string;
}

// Message start event
interface MessageStartEvent extends BaseEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: any[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

// Content block start event
interface ContentBlockStartEvent extends BaseEvent {
  type: "content_block_start";
  index: number;
  content_block: {
    type: string;
    text?: string;
    // tool use
    id?: string;
    name?: string;
    input?: any;
  };
}

// Base interface for content block deltas
interface ContentBlockDeltaBase extends BaseEvent {
  type: "content_block_delta";
  index: number;
  delta: {
    type: string;
  };
}

// Text delta
interface TextDelta extends ContentBlockDeltaBase {
  delta: {
    type: "text_delta";
    text: string;
  };
}

// Input JSON delta (for tool use)
interface InputJSONDelta extends ContentBlockDeltaBase {
  delta: {
    type: "input_json_delta";
    partial_json: string;
  };
}

// Content block stop event
interface ContentBlockStopEvent extends BaseEvent {
  type: "content_block_stop";
  index: number;
}

// Message delta event
interface MessageDeltaEvent extends BaseEvent {
  type: "message_delta";
  delta: {
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

// Message stop event
interface MessageStopEvent extends BaseEvent {
  type: "message_stop";
}

// Ping event
interface PingEvent extends BaseEvent {
  type: "ping";
}

// Error event
interface ErrorEvent extends BaseEvent {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

// Union type for all possible events
type StreamingEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | TextDelta
  | InputJSONDelta
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

// openai stuff:

export type FullToolCallDelta = {
  id: string;
  index: number;
  type: "function";
  function: { name: string; arguments: string };
};
export type PartialToolCallDelta = {
  type: undefined;
  id: undefined;
  index: number;
  function: { arguments: string };
};

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  system_fingerprint: string;
  service_tier?: string | null;
  /** only given if setting stream_options: {"include_usage": true} in request, only given in last stream chunk */
  usage?: null | {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
  choices: {
    index: number;
    delta:
      | {
          role: string;
          content?: string | null;
          /** Important: openai has this type where arguments come later and must be augmented in order. Groq does just have the first one. Badly documented! */
          tool_calls?: (FullToolCallDelta | PartialToolCallDelta)[];

          /** Our own addition */
          tools?: any[];
        }
      | {
          role: undefined;
          content: undefined;
          tool_calls: undefined;
          tools: undefined;
        };
    logprobs: null;
    finish_reason: null | string;
  }[];
  //extra info from different parties
  x_groq?: any;
  x_actionschema?: any;
}

export const POST = async (req: Request) => {
  const openapi = await fetch(new URL(req.url).origin + "/openapi.json").then(
    (res) => res.json(),
  );

  const baseUrl = openapi["x-origin-servers"][0].url;

  const json = await req.json();
  const headers = new Headers({
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": req.headers.get("authorization")?.split(" ")[1] || "",
  });

  const system = json.messages.find((x) => x.role === "system")?.content;
  const messages = json.messages.filter((x) => x.role !== "system");
  console.log({ messages: json.messages, system, other: messages });
  const anthropicBody = {
    model: json.model,
    max_tokens: json.max_tokens || 4096,
    system,
    messages,
    stream: json.stream,
    temperature: json.temperature,
    top_p: json.top_p,
    stop_sequences: json.stop,
  };

  console.log(anthropicBody);
  const result = await fetch(baseUrl + "/messages", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(anthropicBody),
  });

  if (!result.ok) {
    console.log("Err", result.status, result.statusText);

    const text = await result.text();
    console.log("text", text);

    return new Response(text, {
      status: result.status,
      statusText: result.statusText,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (!json.stream) {
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
              const data = JSON.parse(line.slice(6));
              if (data.type === "message_start") {
                controller.enqueue(
                  `data: ${JSON.stringify(transformMessageStart(data))}\n\n`,
                );
              } else if (data.type === "content_block_start") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformContentBlockStart(data, json.model),
                  )}\n\n`,
                );
              } else if (data.type === "content_block_delta") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformContentBlockDelta(data, json.model),
                  )}\n\n`,
                );
              } else if (data.type === "message_delta") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformMessageDelta(data, json.model),
                  )}\n\n`,
                );
              } else if (data.type === "message_stop") {
                controller.enqueue(
                  `data: ${JSON.stringify(
                    transformMessageStop(data, json.model),
                  )}\n\n`,
                );
                controller.enqueue("data: [DONE]\n\n");
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

function transformAnthropicToOpenAI(anthropicResponse: any) {
  return {
    id: anthropicResponse.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: anthropicResponse.content[0].text,
        },
        finish_reason: anthropicResponse.stop_reason,
      },
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage.input_tokens,
      completion_tokens: anthropicResponse.usage.output_tokens,
      total_tokens:
        anthropicResponse.usage.input_tokens +
        anthropicResponse.usage.output_tokens,
    },
  };
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
                    index: 0,
                    type: "function",
                    id: data.content_block.id,
                    function: {
                      name: data.content_block.name,
                      arguments: data.content_block.input,
                    },
                  },
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
  data: TextDelta | InputJSONDelta,
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
                    index: 0,
                    function: { arguments: data.delta.partial_json },
                    type: undefined,
                    id: undefined,
                  },
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
