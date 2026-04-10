import type { KeyboardEvent } from 'react';
import { CornerDownLeft, LoaderCircle, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Mode } from '@/types';

interface ChatInputProps {
  disabled: boolean;
  loading: boolean;
  mode: Mode;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onValueChange: (value: string) => void;
  value: string;
}

export function ChatInput({
  disabled,
  loading,
  mode,
  onKeyDown,
  onSend,
  onValueChange,
  value
}: ChatInputProps) {
  return (
    <div className="rounded-[1.8rem] border border-border/70 bg-card/65 p-3 shadow-[0_22px_70px_-48px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-3">
        <Textarea
          className="min-h-[112px] resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-7 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your prompt..."
          rows={4}
          value={value}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loading ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" />
                {mode === 'stream' ? 'Streaming response...' : 'Waiting for reply...'}
              </>
            ) : (
              <>
                <CornerDownLeft className="size-3.5" />
                Enter to send. Shift+Enter for a new line.
              </>
            )}
          </div>

          <Button disabled={disabled} onClick={onSend} size="lg">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            {loading ? (mode === 'stream' ? 'Streaming' : 'Sending') : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
