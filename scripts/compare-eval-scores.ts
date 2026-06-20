/**
 * Compare `eval-scores.json` across multiple sample-video sets.
 *
 * Reads each `<dir>/eval-scores.json` (produced by
 * `eval-style-sample-videos.ts --dir <dir>`) and prints:
 *   1. A per-set summary — count + mean of every rubric dimension.
 *   2. A per-style overall matrix (one column per set) so you can scan which
 *      styles improved or regressed across iterations.
 *   3. The biggest movers (largest swing between the first and last set).
 *
 * Usage:
 *   bun scripts/compare-eval-scores.ts
 *       # every `sample-videos…` dir that has an eval-scores.json
 *   bun scripts/compare-eval-scores.ts sample-videos-v5 sample-videos-v6 sample-videos
 *       # explicit set list, in the order you want the columns
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const verdictSchema = z.object({
  styleAdherence: z.number(),
  liveliness: z.number(),
  characterConsistency: z.number().nullable(),
  coherence: z.number(),
  overall: z.number(),
});
type Verdict = z.infer<typeof verdictSchema>;

// A motion-only run (or a scoring failure) leaves `verdict` null.
const evalFileSchema = z.object({
  model: z.string(),
  results: z.array(
    z.object({
      slug: z.string(),
      kind: z.string(),
      motion: z.number(),
      verdict: verdictSchema.nullable(),
    })
  ),
});
type Result = z.infer<typeof evalFileSchema>['results'][number];

const DIM = ['overall', 'styleAdherence', 'coherence', 'liveliness'] as const;

function resolveDirs(argv: string[]): string[] {
  if (argv.length > 0) return argv;
  // Order columns chronologically: v1 < v2 < … < the bare `sample-videos`
  // (the current/latest set), which has no -vN suffix and sorts last.
  const versionOf = (d: string): number => {
    const m = /-v(\d+)$/.exec(d);
    return m ? Number(m[1]) : Infinity;
  };
  return readdirSync(process.cwd())
    .filter((d) => d.startsWith('sample-videos'))
    .filter((d) => existsSync(path.join(d, 'eval-scores.json')))
    .sort((a, b) => versionOf(a) - versionOf(b));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(n: number, width = 5): string {
  return (Number.isFinite(n) ? n.toFixed(2) : '—').padStart(width);
}

function main(): void {
  const dirs = resolveDirs(process.argv.slice(2)).filter((d) =>
    existsSync(path.join(d, 'eval-scores.json'))
  );
  if (dirs.length === 0) {
    console.error('No sample-videos*/eval-scores.json found.');
    process.exit(1);
  }

  // dir -> (slug -> overall, using the canonical entry, falling back to bespoke)
  const overallByDir = new Map<string, Map<string, number>>();
  const summaries: {
    dir: string;
    model: string;
    n: number;
    means: Record<string, number>;
  }[] = [];

  for (const dir of dirs) {
    const data = evalFileSchema.parse(
      JSON.parse(readFileSync(path.join(dir, 'eval-scores.json'), 'utf-8'))
    );
    const scored = data.results.filter(
      (r): r is Result & { verdict: Verdict } => r.verdict !== null
    );
    const means: Record<string, number> = {};
    for (const dim of DIM) {
      means[dim] = mean(scored.map((r) => r.verdict[dim]));
    }
    means['motion'] = mean(
      data.results.map((r) => r.motion).filter((m) => Number.isFinite(m))
    );
    summaries.push({ dir, model: data.model, n: data.results.length, means });

    const byStyle = new Map<string, number>();
    for (const r of scored) {
      // Prefer canonical; only let bespoke fill a slot canonical didn't.
      if (r.kind === 'canonical' || !byStyle.has(r.slug)) {
        byStyle.set(r.slug, r.verdict.overall);
      }
    }
    overallByDir.set(dir, byStyle);
  }

  const label = (d: string): string => {
    const base = d.split('/').pop() ?? d;
    return base.replace(/^sample-videos-?/, '') || 'cur';
  };

  // 1. Per-set summary
  console.log('\n=== Per-set summary ===');
  console.log(
    [
      'set'.padEnd(6),
      'n'.padStart(4),
      'overall',
      'style',
      'coher',
      'lively',
      'motion',
    ].join('  ')
  );
  for (const s of summaries) {
    console.log(
      [
        label(s.dir).padEnd(6),
        String(s.n).padStart(4),
        fmt(s.means['overall'] ?? NaN, 7),
        fmt(s.means['styleAdherence'] ?? NaN),
        fmt(s.means['coherence'] ?? NaN),
        fmt(s.means['liveliness'] ?? NaN),
        fmt(s.means['motion'] ?? NaN),
      ].join('  ')
    );
  }

  // overall score for (dir, slug), or undefined if that set lacks the style
  const cell = (d: string, slug: string): number | undefined =>
    overallByDir.get(d)?.get(slug);

  // 2. Per-style overall matrix (styles present in >= 2 sets)
  const allSlugs = [
    ...new Set(dirs.flatMap((d) => [...(overallByDir.get(d)?.keys() ?? [])])),
  ].sort();
  const shared = allSlugs.filter(
    (slug) => dirs.filter((d) => cell(d, slug) !== undefined).length >= 2
  );

  console.log('\n=== Per-style overall (canonical; styles in ≥2 sets) ===');
  console.log(
    ['style'.padEnd(28), ...dirs.map((d) => label(d).padStart(5))].join(' ')
  );
  for (const slug of shared) {
    const cells = dirs.map((d) => {
      const v = cell(d, slug);
      return (v === undefined ? '—' : String(v)).padStart(5);
    });
    console.log([slug.padEnd(28), ...cells].join(' '));
  }

  // 3. Biggest movers — first set that scored the style → last set that did
  type Mover = { slug: string; first: number; last: number; delta: number };
  const movers = shared
    .map((slug): Mover | null => {
      const vals = dirs
        .map((d) => cell(d, slug))
        .filter((v): v is number => v !== undefined);
      const first = vals.at(0);
      const last = vals.at(-1);
      if (first === undefined || last === undefined) return null;
      return { slug, first, last, delta: last - first };
    })
    .filter((m): m is Mover => m !== null && m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log('\n=== Biggest movers (first → last set) ===');
  for (const m of movers.slice(0, 15)) {
    const arrow = m.delta > 0 ? '▲' : '▼';
    console.log(
      `${arrow} ${m.slug.padEnd(28)} ${m.first} → ${m.last}  (${m.delta > 0 ? '+' : ''}${m.delta})`
    );
  }
  console.log('');
}

main();
