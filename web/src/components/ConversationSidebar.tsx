import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/types';

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  loading: boolean;
  onDeleteConversation: (conversation: ConversationSummary) => void;
  onRenameConversation: (conversation: ConversationSummary) => void;
  onSelectConversation: (conversation: ConversationSummary) => void;
}

export function ConversationSidebar({
  conversations,
  currentConversationId,
  loading,
  onDeleteConversation,
  onRenameConversation,
  onSelectConversation
}: ConversationSidebarProps) {
  return (
    <aside className="flex min-h-0 w-full flex-col border-b border-border/60 md:w-72 md:border-b-0 md:border-r">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-medium text-foreground">Conversations</p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {conversations.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              {loading ? 'Loading conversations…' : 'No conversations yet.'}
            </div>
          ) : (
            conversations.map((conversation) => {
              const isActive = conversation.id === currentConversationId;
              return (
                <div
                  key={conversation.id}
                  className={cn('border-b border-border/40 px-3 py-2', isActive && 'bg-secondary/60')}
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

                    <div className="flex shrink-0 items-center gap-0.5">
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
