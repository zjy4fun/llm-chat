import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Mode } from '@/types';

interface SettingsPanelProps {
  mode: Mode;
  model: string;
  onModeChange: (mode: Mode) => void;
  onModelChange: (model: string) => void;
  onSessionIdChange: (sessionId: string) => void;
  onUserIdChange: (userId: string) => void;
  open: boolean;
  sessionId: string;
  userId: string;
}

export function SettingsPanel({
  mode,
  model,
  onModeChange,
  onModelChange,
  onSessionIdChange,
  onUserIdChange,
  open,
  sessionId,
  userId
}: SettingsPanelProps) {
  return (
    <section
      aria-hidden={!open}
      className={cn(
        'grid border-b border-border/60 bg-background/12 transition-[grid-template-rows,opacity] duration-300 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      )}
    >
      <div className="overflow-hidden">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="user-id">User ID</Label>
              <Input id="user-id" onChange={(event) => onUserIdChange(event.target.value)} value={userId} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="session-id">Session ID</Label>
              <Input id="session-id" onChange={(event) => onSessionIdChange(event.target.value)} value={sessionId} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model-name">Model Override</Label>
              <Input id="model-name" onChange={(event) => onModelChange(event.target.value)} value={model} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mode-select">Response Mode</Label>
              <Select value={mode} onValueChange={(value) => onModeChange(value as Mode)}>
                <SelectTrigger id="mode-select">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stream">Stream</SelectItem>
                  <SelectItem value="non-stream">Non-stream</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator className="bg-border/70" />

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-secondary/50 px-3 py-1.5">Advanced request settings</span>
            <span className="rounded-full border border-border/70 bg-secondary/35 px-3 py-1.5">
              These values feed the existing payload helpers unchanged.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
