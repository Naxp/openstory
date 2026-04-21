import { describe, expect, test } from 'bun:test';
import {
  buildFrameComposition,
  buildStandaloneOverlayComposition,
  getRenderDimensions,
} from './compose';
import type { FrameOverlay } from './overlay.types';

describe('buildFrameComposition', () => {
  test('emits stage with 1920x1080 for 16:9 and an underlying video layer', () => {
    const { html, width, height } = buildFrameComposition({
      compositionId: 'frame-1',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 5000,
      aspectRatio: '16:9',
      overlays: [],
    });

    expect(width).toBe(1920);
    expect(height).toBe(1080);
    expect(html).toContain('data-composition-id="frame-1"');
    expect(html).toContain('data-width="1920"');
    expect(html).toContain('data-height="1080"');
    expect(html).toContain(
      '<video data-start="0" data-duration="5" data-track-index="0" src="https://example.com/v.mp4"'
    );
  });

  test('uses 1080x1920 for 9:16 portrait', () => {
    const { width, height } = buildFrameComposition({
      compositionId: 'frame-2',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 3000,
      aspectRatio: '9:16',
      overlays: [],
    });
    expect(width).toBe(1080);
    expect(height).toBe(1920);
  });

  test('renders text overlay with correct timing and position class', () => {
    const overlay: FrameOverlay = {
      kind: 'text',
      id: 't1',
      text: 'Hello World',
      position: 'bottom',
      startMs: 500,
      durationMs: 2000,
    };

    const { html } = buildFrameComposition({
      compositionId: 'frame-3',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 5000,
      aspectRatio: '16:9',
      overlays: [overlay],
    });

    expect(html).toContain('overlay-text');
    expect(html).toContain('overlay-bottom');
    expect(html).toContain('data-start="0.5"');
    expect(html).toContain('data-duration="2"');
    expect(html).toContain('data-track-index="1"');
    expect(html).toContain('Hello World');
  });

  test('renders lower third overlay with title + subtitle', () => {
    const overlay: FrameOverlay = {
      kind: 'lowerThird',
      id: 'lt1',
      title: 'Jane Doe',
      subtitle: 'CEO, Acme Corp',
      startMs: 0,
      durationMs: 4000,
    };

    const { html } = buildFrameComposition({
      compositionId: 'frame-4',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 5000,
      aspectRatio: '16:9',
      overlays: [overlay],
    });

    expect(html).toContain('overlay-lower-third');
    expect(html).toContain('<div class="lt-title">Jane Doe</div>');
    expect(html).toContain('<div class="lt-subtitle">CEO, Acme Corp</div>');
  });

  test('escapes HTML-sensitive characters in text content', () => {
    const overlay: FrameOverlay = {
      kind: 'text',
      id: 't2',
      text: 'A & B < C > D',
      position: 'top',
      startMs: 0,
      durationMs: 1000,
    };

    const { html } = buildFrameComposition({
      compositionId: 'frame-5',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 1000,
      aspectRatio: '16:9',
      overlays: [overlay],
    });

    expect(html).toContain('A &amp; B &lt; C &gt; D');
    expect(html).not.toContain('A & B < C > D');
  });

  test('assigns increasing track indices to each overlay', () => {
    const overlays: FrameOverlay[] = [
      {
        kind: 'text',
        id: 'a',
        text: 'one',
        position: 'top',
        startMs: 0,
        durationMs: 1000,
      },
      {
        kind: 'text',
        id: 'b',
        text: 'two',
        position: 'bottom',
        startMs: 0,
        durationMs: 1000,
      },
    ];

    const { html } = buildFrameComposition({
      compositionId: 'frame-6',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 3000,
      aspectRatio: '16:9',
      overlays,
    });

    expect(html).toContain('data-track-index="1"');
    expect(html).toContain('data-track-index="2"');
  });

  test('renders image overlay with widthPct clamped to 5-100', () => {
    const overlays: FrameOverlay[] = [
      {
        kind: 'image',
        id: 'i1',
        assetUrl: 'https://cdn.example.com/logo.png',
        position: 'center',
        startMs: 0,
        durationMs: 2000,
        widthPct: 150,
      },
    ];

    const { html } = buildFrameComposition({
      compositionId: 'frame-7',
      videoUrl: 'https://example.com/v.mp4',
      durationMs: 3000,
      aspectRatio: '16:9',
      overlays,
    });

    expect(html).toContain('width:100%');
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });
});

describe('buildStandaloneOverlayComposition', () => {
  test('builds title-card composition with background + overlay', () => {
    const overlay: FrameOverlay = {
      kind: 'text',
      id: 'intro',
      text: 'Chapter One',
      position: 'center',
      startMs: 0,
      durationMs: 3000,
    };

    const { html, width } = buildStandaloneOverlayComposition({
      compositionId: 'intro',
      durationMs: 3000,
      aspectRatio: '16:9',
      overlay,
      backgroundColor: '#111',
    });

    expect(width).toBe(1920);
    expect(html).toContain('class="bg-fill"');
    expect(html).toContain('background:#111');
    expect(html).toContain('Chapter One');
  });
});

describe('getRenderDimensions', () => {
  test('maps each aspect ratio to the expected render size', () => {
    expect(getRenderDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(getRenderDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(getRenderDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
  });
});
