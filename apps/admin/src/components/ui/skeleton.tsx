import { cn } from '@/lib/utils';

/** Loading placeholder — keeps layout stable on slow networks. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
