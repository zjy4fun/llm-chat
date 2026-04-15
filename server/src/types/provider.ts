export interface ProviderUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface ProviderCompletion {
  choices: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
  usage?: ProviderUsage | null;
}

export interface ProviderStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: ProviderUsage | null;
}

export interface ProviderStreamResult extends AsyncIterable<ProviderStreamChunk> {
  controller: {
    abort(): void;
  };
}
