import { GRID_BATCH_SIZE, GRID_STATE_KEY } from '../config/constants.js';
import { normalizeGridParams, buildGridHash } from './routing.js';

function safeParseJSON(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

export function readGridSnapshot() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        return safeParseJSON(sessionStorage.getItem(GRID_STATE_KEY));
    } catch (error) {
        return null;
    }
}

export function writeGridSnapshot(snapshot) {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        sessionStorage.setItem(GRID_STATE_KEY, JSON.stringify(snapshot));
    } catch (error) {
        return null;
    }
    return snapshot;
}

export function buildSnapshotFromGridParams(params, visibleCount, scrollY) {
    const normalized = normalizeGridParams(params || {});
    return {
        q: normalized.q,
        sort: normalized.sort,
        from: normalized.from,
        to: normalized.to,
        hasImage: normalized.hasImage,
        hasVideo: normalized.hasVideo,
        visibleCount: Math.max(Number(visibleCount || 0), GRID_BATCH_SIZE),
        scrollY: scrollY !== undefined ? scrollY : globalThis.window?.scrollY || 0,
        hash: buildGridHash(normalized),
        updatedAt: Date.now()
    };
}

export function buildSnapshotFromState(state, overrides) {
    const params = normalizeGridParams({
        q: overrides && overrides.q !== undefined ? overrides.q : state.q,
        sort: overrides && overrides.sort !== undefined ? overrides.sort : state.sort,
        from: overrides && overrides.from !== undefined ? overrides.from : state.dateFrom,
        to: overrides && overrides.to !== undefined ? overrides.to : state.dateTo,
        hasImage: overrides && overrides.hasImage !== undefined ? overrides.hasImage : state.hasImage,
        hasVideo: overrides && overrides.hasVideo !== undefined ? overrides.hasVideo : state.hasVideo
    });

    return buildSnapshotFromGridParams(
        params,
        overrides && overrides.visibleCount !== undefined
            ? overrides.visibleCount
            : state.visibleCount,
        overrides && overrides.scrollY !== undefined
            ? overrides.scrollY
            : globalThis.window?.scrollY || 0
    );
}
