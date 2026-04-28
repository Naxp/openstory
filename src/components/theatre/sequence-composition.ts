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

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#stage{position:relative;width:100%;height:100%}#stage video,#stage audio{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}</style>
  </head>
  <body>
    <div id="stage" data-composition-id="${compositionId}" data-start="0" data-width="${width}" data-height="${height}">
      ${clipMarkup}
      ${audioMarkup}
    </div>
  </body>
</html>`;

  return {
    html,
    totalDurationSeconds,
    playableFrameCount: ordered.length,
  };
};

export const useSequenceComposition = (
  input: CompositionInput
): CompositionData => {
  const { sequenceId, frames, musicUrl, aspectRatio } = input;

  return useMemo(
    () =>
      buildSequenceComposition({ sequenceId, frames, musicUrl, aspectRatio }),
    [sequenceId, frames, musicUrl, aspectRatio]
  );
};
