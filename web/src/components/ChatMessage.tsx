import { Bot, LoaderCircle, Sparkles, UserRound } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageData } from '@/types';

interface ChatMessageProps {
  isStreaming?: boolean;
  message: ChatMessageData;
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-3 whitespace-pre-wrap last:mb-0">{children}</p>,
  code: ({ children, className }) => (
    <code className={cn('rounded bg-background/60 px-1 py-0.5 text-[13px]', className)}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-background/70 p-3 text-[13px] last:mb-0">{children}</pre>
  )
};

export function ChatMessage({ isStreaming = false, message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const title = isUser ? 'You' : isAssistant ? 'Assistant' : message.role;

  return (
    <div className={cn('flex w-full items-start gap-3 [animation:message-in_220ms_ease-out]', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary/65 text-primary">
          {isAssistant ? <Bot className="size-4" /> : <Sparkles className="size-4" />}
        </div>
      ) : null}

      <div
        className={cn(
          'max-w-[min(85%,44rem)] rounded-[1.75rem] px-4 py-3 shadow-[0_24px_72px_-44px_rgba(0,0,0,0.95)]',
          isUser
            ? 'rounded-tr-md bg-sky-500 text-sky-50'
            : 'rounded-tl-md border border-border/70 bg-secondary/72 text-foreground'
        )}
      >
        <div
          className={cn(
            'mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.28em]',
            isUser ? 'text-sky-100/78' : 'text-muted-foreground'
          )}
        >
          {title}
          {isStreaming && isAssistant ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">live</span> : null}
        </div>

        {isStreaming && !message.content ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Generating response...
          </div>
        ) : (
          <div className="break-words text-[15px] leading-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && isAssistant ? (
              <span className="ml-1 inline-block h-4 w-2 rounded-full bg-primary align-[-2px] [animation:stream-cursor_1.15s_steps(1,end)_infinite]" />
            ) : null}
          </div>
        )}
      </div>

      {isUser ? (
        <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-500/14 text-sky-300 ring-1 ring-inset ring-sky-400/28">
          <UserRound className="size-4" />
        </div>
      ) : null}
    </div>
  );
}
