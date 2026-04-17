export function normalizeGridParams(params) {
    return {
        q: (params && params.q ? String(params.q) : '').trim(),
        sort: params && params.sort ? String(params.sort) : 'newest',
        from: params && params.from ? String(params.from) : '',
        to: params && params.to ? String(params.to) : '',
        hasImage: !!(
            params &&
            (params.hasImage === true || params.hasImage === '1' || params.hasImage === 'true')
        ),
        hasVideo: !!(
            params &&
            (params.hasVideo === true || params.hasVideo === '1' || params.hasVideo === 'true')
        )
    };
}

export function buildGridHash(params) {
    const normalized = normalizeGridParams(params);
    const qs = new URLSearchParams();

    if (normalized.q) qs.set('q', normalized.q);
    if (normalized.sort && normalized.sort !== 'newest') qs.set('sort', normalized.sort);
    if (normalized.from) qs.set('from', normalized.from);
    if (normalized.to) qs.set('to', normalized.to);
    if (normalized.hasImage) qs.set('img', '1');
    if (normalized.hasVideo) qs.set('video', '1');

    return qs.toString() ? '#search?' + qs.toString() : '#';
}

export function parseHash(rawHash) {
    const effectiveHash = rawHash !== undefined ? rawHash : globalThis.location?.hash || '#';
    const normalizedHash = effectiveHash || '#';
    const trimmed = normalizedHash.replace(/^#/, '');
    const detailMatch = trimmed.match(/^post\/([^/]+)\/?$/);

    if (trimmed === 'contact' || trimmed === 'support') {
        return {
            view: 'contact',
            rawHash: normalizedHash
        };
    }

    if (detailMatch) {
        return {
            view: 'detail',
            postId: decodeURIComponent(detailMatch[1]),
            rawHash: normalizedHash
        };
    }

    let params = normalizeGridParams({});
    if (trimmed.indexOf('search?') === 0) {
        const searchParams = new URLSearchParams(trimmed.slice(7));
        params = normalizeGridParams({
            q: searchParams.get('q') || '',
            sort: searchParams.get('sort') || 'newest',
            from: searchParams.get('from') || '',
            to: searchParams.get('to') || '',
            hasImage: searchParams.get('img') || '',
            hasVideo: searchParams.get('video') || ''
        });
    }

    return {
        view: 'grid',
        params,
        rawHash: buildGridHash(params)
    };
}

export function setHash(hash, replace) {
    const nextHash = hash || '#';
    const url = globalThis.location.pathname + globalThis.location.search + nextHash;
    if (replace) {
        globalThis.history.replaceState(globalThis.history.state, '', url);
    } else {
        globalThis.location.hash = nextHash.slice(1);
    }
}
