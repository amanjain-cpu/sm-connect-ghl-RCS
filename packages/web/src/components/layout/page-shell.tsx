import type { HTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';

type PageShellProps = PropsWithChildren<{
  className?: string;
  contentClassName?: string;
}>;

export function PageShell({ className, contentClassName, children }: PageShellProps) {
  return (
    <div
      className={cn(
        'w-full px-4 py-4 sm:px-5 sm:py-5 lg:px-5 lg:py-5 xl:px-6 xl:py-6',
        className
      )}
    >
      <div className={cn('mx-auto flex w-full max-w-[1400px] flex-col gap-5', contentClassName)}>
        {children}
      </div>
    </div>
  );
}

export function PageSection({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'rounded-[26px] border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(17,24,39,0.04),0_16px_40px_-24px_rgba(17,24,39,0.18)]',
        className
      )}
      {...props}
    />
  );
}

export function PageInset({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-black/[0.06] bg-[#F7F8FA] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
        className
      )}
      {...props}
    />
  );
}
