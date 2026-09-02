import { exportMarkdown } from './engine.js';

export const READ_SCENE_SECTIONS = Object.freeze(['summary', 'pins', 'comparisons', 'measurements', 'brief']);
export const MAX_READ_ITEMS = 8;
export const MAX_READ_OFFSET = 24;
export const PREVIEW_CHARS = 600;
export const DEFAULT_EXPORT_CHARS = 1500;
export const MAX_EXPORT_CHARS = 2000;

const PREVIEW_FIELDS = ['note', 'body'];

function assertPageInput(section, offset, limit) {
  if (!READ_SCENE_SECTIONS.includes(section)) {
    throw new RangeError(`Unknown scene section "${section}". Valid sections: ${READ_SCENE_SECTIONS.join(', ')}.`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_READ_OFFSET) {
    throw new RangeError(`offset must be an integer from 0 to ${MAX_READ_OFFSET}.`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_READ_ITEMS) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_READ_ITEMS}.`);
  }
}

function summaryFor(scene, context) {
  return {
    title: scene.title,
    revision: scene.revision,
    camera: { ...scene.camera },
    time: scene.time,
    timeZone: 'UTC',
    layers: { ...scene.layers },
    published: scene.published,
    counts: {
      pins: scene.pins.length,
      comparisons: scene.comparisons.length,
      measurements: scene.measurements.length,
      stagedBriefs: scene.stagedBrief ? 1 : 0,
    },
    stagedBriefSummary: scene.stagedBrief
      ? {
          id: scene.stagedBrief.id,
          headline: scene.stagedBrief.headline,
          bodyChars: scene.stagedBrief.body.length,
          at: scene.stagedBrief.at,
        }
      : null,
    historyDepth: context.historyDepth ?? scene.history?.length ?? 0,
    catalogSize: context.catalogSize,
    activeToolCount: context.activeToolCount,
    visibleUserControls: ['review-and-publish', 'reopen-scene', 'manual camera, time, places, and layers'],
  };
}

function sectionItems(scene, section) {
  return section === 'brief' ? (scene.stagedBrief ? [scene.stagedBrief] : []) : scene[section];
}

function previewItem(item) {
  const copy = structuredClone(item);
  let previewed = false;
  for (const field of PREVIEW_FIELDS) {
    if (typeof copy[field] === 'string' && copy[field].length > PREVIEW_CHARS) {
      copy[`${field}Preview`] = copy[field].slice(0, PREVIEW_CHARS);
      copy[`${field}Chars`] = copy[field].length;
      delete copy[field];
      previewed = true;
    }
  }
  return { copy, previewed };
}

export function readScenePage(scene, { section = 'summary', offset = 0, limit = MAX_READ_ITEMS, id } = {}, context = {}) {
  assertPageInput(section, offset, limit);
  if (section === 'summary') {
    if (id !== undefined) throw new RangeError('id requires a named section: pins, comparisons, measurements, or brief.');
    return { ...summaryFor(scene, context), section };
  }

  const source = sectionItems(scene, section);
  const base = { section, revision: scene.revision, published: scene.published };
  if (id !== undefined) {
    const item = source.find((entry) => entry.id === id);
    if (!item) {
      const known = source.map((entry) => entry.id);
      throw new Error(`Unknown ${section} id "${id}". ${known.length ? `Known ids: ${known.join(', ')}.` : `The ${section} section is empty.`}`);
    }
    return { ...base, id, item: structuredClone(item) };
  }

  const previews = source.slice(offset, offset + limit).map(previewItem);
  const items = previews.map((entry) => entry.copy);
  const previewed = previews.filter((entry) => entry.previewed).length;
  const nextOffset = offset + items.length < source.length ? offset + items.length : null;
  return {
    ...base,
    page: {
      id: `terra-${section}-r${scene.revision}-${offset}`,
      total: source.length,
      offset,
      limit,
      returned: items.length,
      previewed,
      nextOffset,
      done: nextOffset === null,
    },
    ...(previewed
      ? { hint: `${previewed} item(s) show the first ${PREVIEW_CHARS} characters of long text. Call terra_read_scene with section "${section}" and that item's id for the complete record.` }
      : {}),
    items,
  };
}

export function exportMarkdownChunk(scene, { offset = 0, maxChars = DEFAULT_EXPORT_CHARS } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 250_000) {
    throw new RangeError('offset must be an integer from 0 to 250000.');
  }
  if (!Number.isInteger(maxChars) || maxChars < 250 || maxChars > MAX_EXPORT_CHARS) {
    throw new RangeError(`maxChars must be an integer from 250 to ${MAX_EXPORT_CHARS}.`);
  }
  const markdown = exportMarkdown(scene);
  const chunk = markdown.slice(offset, offset + maxChars);
  const nextOffset = offset + chunk.length < markdown.length ? offset + chunk.length : null;
  return {
    exportId: `terra-markdown-r${scene.revision}`,
    revision: scene.revision,
    published: scene.published,
    offset,
    maxChars,
    returnedChars: chunk.length,
    totalChars: markdown.length,
    nextOffset,
    done: nextOffset === null,
    markdownChunk: chunk,
  };
}
