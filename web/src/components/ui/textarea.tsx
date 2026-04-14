import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-28 w-full rounded-[1.5rem] border border-input bg-background/50 px-4 py-3 text-sm text-foreground transition focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
