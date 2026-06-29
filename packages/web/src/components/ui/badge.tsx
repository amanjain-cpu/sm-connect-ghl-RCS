import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        secondary: 'bg-secondary text-secondary-foreground border border-border',
        success: 'bg-primary/10 text-primary',
        warning: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
        destructive: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
        info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
        outline: 'border border-border bg-transparent text-foreground',
        ghost: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', {
            'bg-primary': variant === 'default' || variant === 'success' || !variant,
            'bg-amber-500 dark:bg-amber-400': variant === 'warning',
            'bg-red-500 dark:bg-red-400': variant === 'destructive',
            'bg-sky-500 dark:bg-sky-400': variant === 'info',
            'bg-muted-foreground': variant === 'ghost' || variant === 'outline' || variant === 'secondary',
          })}
        />
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
