import { parseStyleConfig } from '@/lib/style/style-config';

/**
 * Generate a CSS gradient string from a style's color palette.
 * Used as a fallback when preview images are unavailable or fail to load.
 */
export function getStyleGradient(colorPalette: string[]): string {
  if (!colorPalette.length)
    return 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--muted-foreground) / 0.2))';
  return `conic-gradient(from 135deg, ${colorPalette.join(', ')})`;
}

/**
 * Gradient from a raw `Style.config` blob, tolerating the legacy v1 shape (the
 * palette moved to `config.look.colorPalette` in v2). Use this from list/grid UI
 * that renders rows which may not be backfilled yet.
 */
export function getStyleGradientFromConfig(config: unknown): string {
  return getStyleGradient(parseStyleConfig(config).look.colorPalette);
}
