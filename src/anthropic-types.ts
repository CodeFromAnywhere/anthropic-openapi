/**
 * Represents the request body for creating a message using the Messages API.
 */
export interface CreateMessageRequest {
  /**
   * The model that will complete your prompt.
   * See models for additional details and options.
   */
  model: string;

  /**
   * Input messages for the conversation.
   * Our models are trained to operate on alternating user and assistant conversational turns.
   * The first message must always use the user role.
   */
  messages: AnthropicMessage[];

  /**
   * The maximum number of tokens to generate before stopping.
   * Note that models may stop before reaching this maximum.
   * Different models have different maximum values for this parameter.
   */
  max_tokens: number;

  /**
   * An object describing metadata about the request.
   */
  metadata?: RequestMetadata;

  /**
   * Custom text sequences that will cause the model to stop generating.
   * If encountered, the response stop_reason will be "stop_sequence".
   */
  stop_sequences?: string[];

  /**
   * Whether to incrementally stream the response using server-sent events.
   */
  stream?: boolean;

  /**
   * System prompt to provide context and instructions to Claude.
   */
  system?: SystemPrompt[] | string;

  /**
   * Amount of randomness injected into the response.
   * Defaults to 1.0. Ranges from 0.0 to 1.0.
   * Use temperature closer to 0.0 for analytical / multiple choice, and closer to 1.0 for creative and generative tasks.
   */
  temperature?: number;

  /**
   * How the model should use the provided tools.
   */
  tool_choice?: ToolChoice;

  /**
   * Definitions of tools that the model may use.
   */
  tools?: Tool[];

  /**
   * Only sample from the top K options for each subsequent token.
   * Used to remove "long tail" low probability responses.
   * Recommended for advanced use cases only.
   */
  top_k?: number;

  /**
   * Use nucleus sampling.
   * Recommended for advanced use cases only.
   */
  top_p?: number;
}

/**
 * Represents a message in the conversation.
 */
export interface AnthropicMessage {
  /**
   * The role of the message sender.
   */
  role: "user" | "assistant";

  /**
   * The content of the message.
   * Can be a string or an array of ContentBlock objects.
   */
  content: string | ContentBlock[];
}

/**
 * Represents a block of content in a message.
 */
export type ContentBlock =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent;

/**
 * Represents a text content block.
 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * Represents an image content block.
 */
export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

/**
 * Represents a tool use content block.
 */
export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, any>;
}

/**
 * Represents a tool result content block.
 */
export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content: string;
}

/**
 * Represents metadata about the request.
 */
export interface RequestMetadata {
  /**
   * An external identifier for the user associated with the request.
   * Should be a uuid, hash value, or other opaque identifier.
   */
  user_id?: string;
}

/**
 * Represents a system prompt.
 */
export interface SystemPrompt {
  type: "text";
  text: string;
  /** Not supported yet for every client */
  cache_control?: { type: "ephemeral" } | null;
}

/**
 * Represents how the model should use the provided tools.
 */
export type ToolChoice = AutoToolChoice | AnyToolChoice | SpecificToolChoice;

/**
 * Represents automatic tool choice by the model.
 */
export interface AutoToolChoice {
  type: "auto";
}

/**
 * Represents allowing the model to use any available tool.
 */
export interface AnyToolChoice {
  type: "any";
}

/**
 * Represents specifying a specific tool for the model to use.
 */
export interface SpecificToolChoice {
  type: "tool";
  name: string;
}

/**
 * Represents a tool definition.
 */
export interface Tool {
  /**
   * Name of the tool.
   */
  name: string;

  /**
   * Description of what this tool does.
   * Should be as detailed as possible.
   */
  description?: string;

  /**
   * JSON schema for this tool's input.
   */
  input_schema: Record<string, any>;
}

/**
 * Represents the response from creating a message.
 */
export interface CreateMessageResponse {
  /**
   * Unique object identifier.
   */
  id: string;

  /**
   * Object type. Always "message" for Messages.
   */
  type: "message";

  /**
   * Conversational role of the generated message. Always "assistant".
   */
  role: "assistant";

  /**
   * Content generated by the model.
   */
  content: ContentBlock[];

  /**
   * The model that handled the request.
   */
  model: string;

  /**
   * The reason that generation stopped.
   */
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;

  /**
   * Which custom stop sequence was generated, if any.
   */
  stop_sequence: string | null;

  /**
   * Billing and rate-limit usage information.
   */
  usage: UsageInfo;
}

/**
 * Represents usage information for billing and rate-limiting.
 */
export interface UsageInfo {
  /**
   * The number of input tokens which were used.
   */
  input_tokens: number;

  /**
   * (prompt caching beta) The number of input tokens used to create the cache entry.
   */
  cache_creation_input_tokens: number | null;

  /**
   * (prompt caching beta) The number of input tokens read from the cache.
   */
  cache_read_input_tokens: number | null;

  /**
   * The number of output tokens which were used.
   */
  output_tokens: number;
}

/**
 * Represents the base structure for all streaming events.
 */
export interface StreamEvent {
  /**
   * The type of the streaming event.
   */
  type: string;
}

/**
 * Represents the start of a message in the streaming response.
 */
export interface MessageStartEvent extends StreamEvent {
  type: "message_start";
  message: Omit<CreateMessageResponse, "content"> & { content: [] };
}

/**
 * Represents the start of a content block in the streaming response.
 */
export interface ContentBlockStartEvent extends StreamEvent {
  type: "content_block_start";
  index: number;
  content_block: ContentBlock;
}

/**
 * Represents a delta update to a content block in the streaming response.
 */
export interface ContentBlockDeltaEvent extends StreamEvent {
  type: "content_block_delta";
  index: number;
  delta: TextDelta | InputJsonDelta;
}

/**
 * Represents a text delta update.
 */
export interface TextDelta {
  type: "text_delta";
  text: string;
}

/**
 * Represents an input JSON delta update for tool use.
 */
export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

/**
 * Represents the end of a content block in the streaming response.
 */
export interface ContentBlockStopEvent extends StreamEvent {
  type: "content_block_stop";
  index: number;
}

/**
 * Represents a delta update to the message in the streaming response.
 */
export interface MessageDeltaEvent extends StreamEvent {
  type: "message_delta";
  delta: Partial<CreateMessageResponse>;
  usage: Partial<UsageInfo>;
}

/**
 * Represents the end of a message in the streaming response.
 */
export interface MessageStopEvent extends StreamEvent {
  type: "message_stop";
}

/**
 * Represents a ping event in the streaming response.
 */
export interface PingEvent extends StreamEvent {
  type: "ping";
}

/**
 * Represents an error event in the streaming response.
 */
export interface ErrorEvent extends StreamEvent {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

/**
 * Represents all possible event types in the streaming response.
 */
export type StreamResponseEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

/**
 * Represents the structure of a server-sent event in the streaming response.
 */
export interface ServerSentEvent {
  /**
   * The name of the event.
   */
  event: string;

  /**
   * The JSON data associated with the event.
   */
  data: string;
}
