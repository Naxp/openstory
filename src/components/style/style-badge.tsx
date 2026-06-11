import type React from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useStyles } from '@/hooks/use-styles';
import { cn } from '@/lib/utils';

// Tinted chip treatments from the Tailwind palette. A style name always hashes
// to the same entry, so the same style gets the same color everywhere.
const BADGE_COLORS = [
  'bg-red-500/15 text-red-700 dark:text-red-400',
  'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'bg-lime-500/15 text-lime-700 dark:text-lime-400',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
  'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400',
  'bg-rose-500/15 text-rose-700 dark:text-rose-400',
];

function getStyleBadgeColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length] ?? '';
}

type StyleBadgeProps = {
  // undefined while the owning sequence is still loading
  styleId?: string;
};

/**
 * Shows a sequence's style name as a deterministically-colored badge (#886).
 * Resolves the name from the team+public style catalogue already cached by
 * `useStyles`, so rendering many badges costs a single query.
 */
export const StyleBadge: React.FC<StyleBadgeProps> = ({ styleId }) => {
  const { data: styles } = useStyles();

  if (!styleId || !styles) {
    return <Skeleton className="w-[80px] h-[20px] rounded-4xl" />;
  }

  const style = styles.find((s) => s.id === styleId);
  if (!style) return null;

  return (
    <Badge
      className={cn('text-xs', getStyleBadgeColor(style.name))}
      title={`Style: ${style.name}`}
    >
      {style.name}
    </Badge>
  );
};
