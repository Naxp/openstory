import {
  type AspectRatio,
  aspectRatioToDimensions,
} from '@/lib/constants/aspect-ratios';
import type { Frame } from '@/types/database';
import { useMemo } from 'react';

const DEFAULT_FRAME_DURATION_MS = 3000;

type CompositionInput = {
  sequenceId: string;
  frames: Frame[];
  musicUrl: string | null | undefined;
  aspectRatio: AspectRatio;
};

export type CompositionData = {
  html: string;
  totalDurationSeconds: number;
  playableFrameCount: number;
};

export type CompositionSrcInfo = {
  src: string | null;
  totalDurationSeconds: number;
  playableFrameCount: number;
};

type PlayableFrame = Frame & { videoUrl: string };

const isPlayable = (f: Frame): f is PlayableFrame =>
  f.videoStatus === 'completed' && !!f.videoUrl;

const playableFrames = (frames: Frame[]): PlayableFrame[] =>
  frames.filter(isPlayable).sort((a, b) => a.orderIndex - b.orderIndex);

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export const buildSequenceComposition = ({
  sequenceId,
  frames,
  musicUrl,
  aspectRatio,
}: CompositionInput): CompositionData => {
  const ordered = playableFrames(frames);
  const { width, height } = aspectRatioToDimensions(aspectRatio);

  if (ordered.length === 0) {
    return { html: '', totalDurationSeconds: 0, playableFrameCount: 0 };
  }

  let cursor = 0;
  const clipMarkup = ordered
    .map((frame, idx) => {
      const durationMs = frame.durationMs ?? DEFAULT_FRAME_DURATION_MS;
      const start = cursor;
      const duration = durationMs / 1000;
      cursor += duration;
      const src = escapeAttr(frame.videoUrl);
      return `<video id="clip-${idx}" data-start="${start}" data-duration="${duration}" data-track-index="0" muted playsinline preload="auto" src="${src}"></video>`;
    })
    .join('\n      ');

  const totalDurationSeconds = cursor;

  const audioMarkup = musicUrl
    ? `<audio id="bg" data-start="0" data-duration="${totalDurationSeconds}" data-track-index="1" data-volume="0.5" preload="auto" src="${escapeAttr(musicUrl)}"></audio>`
    : '';

  const compositionId = escapeAttr(`seq-${sequenceId}`);

  // The hyperframes runtime drives a GSAP timeline registered at
  // window.__timelines[id]. It does not build one from raw data-* attrs, so
  // we author one here: tl.call() triggers play/pause on each clip at its
  // start/end, with tl.set() handling visibility.
  const timelineScript = `
      const gsap = window.gsap;
      const root = document.querySelector('[data-composition-id]');
      const id = root.getAttribute('data-composition-id');
      const tl = gsap.timeline({ paused: true });
      const items = root.querySelectorAll('video[data-start], audio[data-start]');
      const playMedia = (el) => { try { el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} };
      const pauseMedia = (el) => { try { el.pause(); el.currentTime = 0; } catch (_) {} };
      items.forEach((el) => {
        const start = parseFloat(el.dataset.start) || 0;
        const dur = parseFloat(el.dataset.duration) || 0;
        const isVideo = el.tagName === 'VIDEO';
        gsap.set(el, { autoAlpha: isVideo ? 0 : 1 });
        if (isVideo) tl.set(el, { autoAlpha: 1 }, start);
        tl.call(playMedia, [el], start);
        if (isVideo) tl.set(el, { autoAlpha: 0 }, start + dur);
        tl.call(pauseMedia, [el], start + dur);
      });
      window.__timelines = window.__timelines || {};
      window.__timelines[id] = tl;`;

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#stage{position:relative;width:100%;height:100%}#stage video,#stage audio{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}</style>
    <script src="/vendor/gsap.min.js"></script>
  </head>
  <body>
    <div id="stage" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}">
      ${clipMarkup}
      ${audioMarkup}
    </div>
    <script>${timelineScript}</script>
    <!-- Hyperframes runtime bootstraps on DOMContentLoaded and wires
         __timelines into a __player object the web component drives. -->
    <script src="/vendor/hyperframe.runtime.iife.js"></script>
  </body>
</html>`;

  return {
    html,
    totalDurationSeconds,
    playableFrameCount: ordered.length,
  };
};

// FNV-1a — small deterministic hash used as an iframe-cache-bust key.
// Cryptographically meaningless; only needs to flip when the playable
// content changes so the browser re-fetches the composition document.
const fnv1a = (s: string): number => {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93);
  }
  return h >>> 0;
};

export const computeCompositionSrc = ({
  sequenceId,
  frames,
  musicUrl,
  aspectRatio,
}: CompositionInput): CompositionSrcInfo => {
  const ordered = playableFrames(frames);
  if (ordered.length === 0) {
    return { src: null, totalDurationSeconds: 0, playableFrameCount: 0 };
  }

  let totalDurationSeconds = 0;
  for (const f of ordered) {
    totalDurationSeconds += (f.durationMs ?? DEFAULT_FRAME_DURATION_MS) / 1000;
  }

  const fingerprint = JSON.stringify({
    f: ordered.map((f) => [
      f.id,
      f.videoUrl,
      f.durationMs ?? DEFAULT_FRAME_DURATION_MS,
    ]),
    m: musicUrl ?? null,
    a: aspectRatio,
  });
  const v = fnv1a(fingerprint).toString(36);
  const src = `/api/sequences/${encodeURIComponent(sequenceId)}/composition.html?v=${v}`;

  return {
    src,
    totalDurationSeconds,
    playableFrameCount: ordered.length,
  };
};

export const useSequenceCompositionSrc = (
  input: CompositionInput
): CompositionSrcInfo => {
  const { sequenceId, frames, musicUrl, aspectRatio } = input;

  return useMemo(
    () => computeCompositionSrc({ sequenceId, frames, musicUrl, aspectRatio }),
    [sequenceId, frames, musicUrl, aspectRatio]
  );
};
