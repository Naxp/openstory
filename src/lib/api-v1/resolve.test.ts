import type {
  LibraryLocation,
  Style,
  Talent,
  TalentWithSheets,
} from '@/lib/db/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the runtime side-effecting deps of resolve.ts so the module imports
// cleanly in Node and element ingestion is observable. `#storage` and the
// vision client never run for real here.
const uploadFileMock = vi.fn(async () => undefined);
const describeElementImageMock = vi.fn(async () => ({
  description: 'a red hexagon brand logo',
  consistencyTag: 'red-hex-brand-logo',
  suggestedToken: 'BRAND_LOGO',
}));

vi.doMock('#storage', () => ({ uploadFile: uploadFileMock }));
vi.doMock('@/lib/ai/element-vision', () => ({
  describeElementImage: describeElementImageMock,
}));
vi.doMock('@/lib/storage/buckets', () => ({
  STORAGE_BUCKETS: { ELEMENTS: 'elements' },
  getPublicUrl: (bucket: string, path: string) =>
    `https://cdn.test/${bucket}/${path}`,
}));
vi.doMock('@/lib/db/id', () => ({ generateId: () => 'gen-1' }));

const { resolveStyle, resolveTalentIds, resolveLocationIds, ingestElements } =
  await import('./resolve');

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    teamId: 'team-1',
    name: 'Cinematic Noir',
    description: null,
    config: {
      mood: 'tense',
      artStyle: 'noir',
      lighting: 'low-key',
      colorPalette: ['#000'],
      cameraWork: 'handheld',
      referenceFilms: [],
      colorGrading: 'desaturated',
    },
    category: null,
    tags: [],
    isPublic: false,
    isTemplate: false,
    version: 1,
    previewUrl: null,
    sampleVideos: [],
    recommendedImageModel: null,
    recommendedVideoModel: null,
    defaultAspectRatio: null,
    useCases: [],
    sortOrder: 100,
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    ...overrides,
  };
}

function makeTalent(
  overrides: Partial<TalentWithSheets> = {}
): TalentWithSheets {
  const base: Talent = {
    id: 'talent-1',
    teamId: 'team-1',
    name: 'Ada Lovelace',
    description: null,
    imageUrl: null,
    imagePath: null,
    isFavorite: false,
    isHuman: true,
    isInTeamLibrary: true,
    isPublic: false,
    isTemplate: false,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    ...base,
    sheets: [],
    sheetCount: 0,
    defaultSheet: null,
    ...overrides,
  };
}

function makeLocation(
  overrides: Partial<LibraryLocation> = {}
): LibraryLocation {
  return {
    id: 'loc-1',
    teamId: 'team-1',
    name: 'Rooftop Bar',
    description: null,
    referenceImageUrl: null,
    referenceImagePath: null,
    isPublic: false,
    isTemplate: false,
    referenceInputHash: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('resolveStyle', () => {
  const styles = [
    makeStyle({ id: 'style-popular', name: 'Cinematic Noir' }),
    makeStyle({ id: 'style-2', name: 'Pixel Art Adventure' }),
  ];
  const deps = { styles: { list: async () => styles } };

  it('auto-picks the first (most popular) style when no ref is given', async () => {
    const style = await resolveStyle(deps, undefined);
    expect(style.id).toBe('style-popular');
  });

  it('matches by exact id', async () => {
    const style = await resolveStyle(deps, 'style-2');
    expect(style.name).toBe('Pixel Art Adventure');
  });

  it('matches by name (case-insensitive)', async () => {
    const style = await resolveStyle(deps, 'cinematic noir');
    expect(style.id).toBe('style-popular');
  });

  it('matches by slugified name', async () => {
    const style = await resolveStyle(deps, 'pixel-art-adventure');
    expect(style.id).toBe('style-2');
  });

  it('throws NotFound when a given ref matches nothing', async () => {
    await expect(resolveStyle(deps, 'does-not-exist')).rejects.toThrow(
      /No style found/
    );
  });

  it('throws when the team has no styles at all', async () => {
    await expect(
      resolveStyle({ styles: { list: async () => [] } }, undefined)
    ).rejects.toThrow(/No styles are available/);
  });
});

describe('resolveTalentIds', () => {
  it('resolves existing talent by name and id', async () => {
    const talent = [
      makeTalent({ id: 't-ada', name: 'Ada Lovelace' }),
      makeTalent({ id: 't-grace', name: 'Grace Hopper' }),
    ];
    const deps = {
      talent: { list: async () => talent, create: vi.fn() },
    };
    const ids = await resolveTalentIds(
      deps,
      ['Ada Lovelace', 't-grace'],
      undefined
    );
    expect(ids).toEqual(['t-ada', 't-grace']);
    expect(deps.talent.create).not.toHaveBeenCalled();
  });

  it('creates new talent and returns its id', async () => {
    const createMock = vi.fn(async (data: { name: string }) =>
      makeTalent({ id: 't-new', name: data.name })
    );
    const deps = { talent: { list: async () => [], create: createMock } };
    const ids = await resolveTalentIds(deps, undefined, [
      { name: 'New Hero', description: 'brave' },
    ]);
    expect(ids).toEqual(['t-new']);
    expect(createMock).toHaveBeenCalledWith({
      name: 'New Hero',
      description: 'brave',
      isInTeamLibrary: true,
    });
  });

  it('throws NotFound when a referenced talent is missing', async () => {
    const deps = { talent: { list: async () => [], create: vi.fn() } };
    await expect(resolveTalentIds(deps, ['Nobody'], undefined)).rejects.toThrow(
      /No character\/talent found/
    );
  });

  it('dedupes overlapping ids', async () => {
    const talent = [makeTalent({ id: 't-ada', name: 'Ada Lovelace' })];
    const deps = { talent: { list: async () => talent, create: vi.fn() } };
    const ids = await resolveTalentIds(
      deps,
      ['t-ada', 'Ada Lovelace'],
      undefined
    );
    expect(ids).toEqual(['t-ada']);
  });
});

describe('resolveLocationIds', () => {
  it('resolves existing and creates new locations', async () => {
    const locations = [makeLocation({ id: 'l-roof', name: 'Rooftop Bar' })];
    const createMock = vi.fn(async (data: { name: string }) =>
      makeLocation({ id: 'l-new', name: data.name })
    );
    const deps = {
      locations: { list: async () => locations, create: createMock },
    };
    const ids = await resolveLocationIds(
      deps,
      ['Rooftop Bar'],
      [{ name: 'Beach' }]
    );
    expect(ids).toEqual(['l-roof', 'l-new']);
  });
});

describe('ingestElements', () => {
  beforeEach(() => {
    uploadFileMock.mockClear();
    describeElementImageMock.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new ArrayBuffer(8),
      }))
    );
  });

  const deps = {
    apiKeys: {
      resolveKey: async () => ({ key: 'or-key', source: 'team' as const }),
    },
  };

  it('returns [] for no elements', async () => {
    expect(await ingestElements(deps, 'team-1', undefined)).toEqual([]);
    expect(await ingestElements(deps, 'team-1', [])).toEqual([]);
  });

  it('uploads to a temp path and runs vision, returning a promotable upload', async () => {
    const [upload] = await ingestElements(deps, 'team-1', [
      { url: 'https://host/logo.png', filename: 'logo.png' },
    ]);

    expect(uploadFileMock).toHaveBeenCalledWith(
      'elements',
      'team-1/temp/gen-1.png',
      expect.any(Uint8Array),
      { contentType: 'image/png' }
    );
    expect(upload).toEqual({
      tempPath: 'elements/team-1/temp/gen-1.png',
      tempPublicUrl: 'https://cdn.test/elements/team-1/temp/gen-1.png',
      filename: 'logo.png',
      // No explicit token → vision's suggestion is used.
      token: 'BRAND_LOGO',
      description: 'a red hexagon brand logo',
      consistencyTag: 'red-hex-brand-logo',
    });
  });

  it('prefers a caller-supplied token over the vision suggestion', async () => {
    const [upload] = await ingestElements(deps, 'team-1', [
      { url: 'https://host/x.jpg', token: 'MY_LOGO' },
    ]);
    expect(upload?.token).toBe('MY_LOGO');
  });

  it('throws when the source image cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      }))
    );
    await expect(
      ingestElements(deps, 'team-1', [{ url: 'https://host/missing.png' }])
    ).rejects.toThrow(/could not be fetched/);
  });

  it('rejects an SSRF target before any fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      ingestElements(deps, 'team-1', [{ url: 'http://169.254.169.254/latest' }])
    ).rejects.toThrow(/not allowed/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
