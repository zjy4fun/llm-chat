export interface ProviderUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface ProviderToolCall {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ProviderCompletion {
  choices: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: ProviderToolCall[] | null;
    } | null;
  }>;
  usage?: ProviderUsage | null;
}

export interface ProviderStreamChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      role?: string | null;
      content?: string | null;
      tool_calls?: ProviderToolCall[];
    };
  }>;
  usage?: ProviderUsage | null;
}

export interface ProviderStreamResult extends AsyncIterable<ProviderStreamChunk> {
  controller: {
    abort(): void;
  };
}
