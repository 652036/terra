import { exportMarkdown } from './engine.js';

export const READ_SCENE_SECTIONS = Object.freeze(['summary', 'pins', 'comparisons', 'measurements', 'brief']);
export const MAX_READ_ITEMS = 1;
export const DEFAULT_EXPORT_CHARS = 1500;
export const MAX_EXPORT_CHARS = 2000;

function assertPageInput(section, offset, limit) {
  if (!READ_SCENE_SECTIONS.includes(section)) throw new RangeError(`Unknown scene section: ${section}`);
  if (!Number.isInteger(offset) || offset < 0 || offset > 24) throw new RangeError('offset must be an integer from 0 to 24');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_READ_ITEMS) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_READ_ITEMS}`);
  }
}

function summaryFor(scene, context) {
  return {
    title: scene.title,
    revision: scene.revision,
    camera: { ...scene.camera },
    time: scene.time,
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

export function readScenePage(scene, { section = 'summary', offset = 0, limit = MAX_READ_ITEMS } = {}, context = {}) {
  assertPageInput(section, offset, limit);
  const summary = summaryFor(scene, context);
  if (section === 'summary') return { ...summary, section };

  const source = section === 'brief'
    ? (scene.stagedBrief ? [scene.stagedBrief] : [])
    : scene[section];
  const items = structuredClone(source.slice(offset, offset + limit));
  const nextOffset = offset + items.length < source.length ? offset + items.length : null;
  return {
    ...summary,
    section,
    page: {
      id: `terra-${section}-r${scene.revision}-${offset}`,
      total: source.length,
      offset,
      limit,
      returned: items.length,
      nextOffset,
      done: nextOffset === null,
    },
    items,
  };
}

export function exportMarkdownChunk(scene, { offset = 0, maxChars = DEFAULT_EXPORT_CHARS } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 250_000) {
    throw new RangeError('offset must be an integer from 0 to 250000');
  }
  if (!Number.isInteger(maxChars) || maxChars < 250 || maxChars > MAX_EXPORT_CHARS) {
    throw new RangeError(`maxChars must be an integer from 250 to ${MAX_EXPORT_CHARS}`);
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
