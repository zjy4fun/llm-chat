import { ChevronDown, ChevronUp, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { Mode } from '@/types';

interface ModelOption {
  label: string;
  value: string;
}

interface ChatHeaderProps {
  messageCount: number;
  mode: Mode;
  model: string;
  modelOptions: ModelOption[];
  onModeChange: (mode: Mode) => void;
  onModelChange: (model: string) => void;
  onToggleSettings: () => void;
  sessionId: string;
  settingsOpen: boolean;
}

export function ChatHeader({
  messageCount,
  mode,
  model,
  modelOptions,
  onModeChange,
  onModelChange,
  onToggleSettings,
  sessionId,
  settingsOpen
}: ChatHeaderProps) {
  return (
    <header className="border-b border-border/60 bg-background/22 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/14 text-primary ring-1 ring-inset ring-primary/24">
                <Sparkles className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.32em] text-muted-foreground">LLM Chat</p>
                <h1 className="font-display text-2xl leading-none sm:text-3xl">A sharper shell for backend testing.</h1>
              </div>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
              Model selection stays front and center, while advanced request identity controls tuck into a collapsible
              panel instead of crowding the composer.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Model</p>
                <Select value={model} onValueChange={onModelChange}>
                  <SelectTrigger className="w-full min-w-[13rem]">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Mode</p>
                <Select value={mode} onValueChange={(value) => onModeChange(value as Mode)}>
                  <SelectTrigger className="w-full min-w-[11rem]">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stream">Stream</SelectItem>
                    <SelectItem value="non-stream">Non-stream</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              className="min-w-[11rem]"
              onClick={onToggleSettings}
              variant={settingsOpen ? 'secondary' : 'outline'}
            >
              <Settings2 className="size-4" />
              {settingsOpen ? 'Hide settings' : 'Show settings'}
              {settingsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-secondary/55 px-3 py-1.5">Session {sessionId}</span>
          <span className="rounded-full border border-border/70 bg-secondary/45 px-3 py-1.5">
            {messageCount} {messageCount === 1 ? 'message' : 'messages'}
          </span>
          <span className="rounded-full border border-border/70 bg-secondary/35 px-3 py-1.5">
            {mode === 'stream' ? 'Live incremental output' : 'Single reply payload'}
          </span>
        </div>
      </div>
    </header>
  );
}
