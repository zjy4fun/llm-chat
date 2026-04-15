import { MessageSquarePlus, Pencil, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/types';

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  loading: boolean;
  onCreateConversation: () => void;
  onDeleteConversation: (conversation: ConversationSummary) => void;
  onRenameConversation: (conversation: ConversationSummary) => void;
  onSelectConversation: (conversation: ConversationSummary) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}

export function ConversationSidebar({
  conversations,
  currentConversationId,
  loading,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation,
  searchQuery,
  onSearchQueryChange
}: ConversationSidebarProps) {
  return (
    <aside className="flex min-h-0 w-full max-w-sm flex-col border-b border-border/60 bg-background/22 md:max-w-[21rem] md:border-b-0 md:border-r">
      <div className="space-y-4 border-b border-border/60 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-muted-foreground">Conversations</p>
            <h2 className="mt-1 text-lg font-semibold">Workspace history</h2>
          </div>
          <Button className="shrink-0" onClick={onCreateConversation} size="sm" variant="secondary">
            <MessageSquarePlus className="size-4" />
            New conversation
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search conversations"
            className="pl-9"
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search conversations"
            value={searchQuery}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {conversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
              {loading ? 'Loading conversations…' : 'No conversations yet. Start a new one from the button above.'}
            </div>
          ) : (
            conversations.map((conversation) => {
              const isActive = conversation.id === currentConversationId;
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'rounded-2xl border border-border/60 bg-card/55 p-3 transition-colors',
                    isActive && 'border-primary/35 bg-primary/8'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      aria-label={`Open ${conversation.title}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectConversation(conversation)}
                      type="button"
                    >
                      <div className="truncate text-sm font-medium text-foreground">{conversation.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {conversation.message_count} {conversation.message_count === 1 ? 'message' : 'messages'}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        aria-label={`Rename ${conversation.title}`}
                        onClick={() => onRenameConversation(conversation)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        aria-label={`Delete ${conversation.title}`}
                        onClick={() => onDeleteConversation(conversation)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
