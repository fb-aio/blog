import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGridHash, normalizeGridParams, parseHash, setHash } from '../src/utils/routing.js';

test('normalizeGridParams coerces query and boolean flags', function () {
    assert.deepEqual(normalizeGridParams({ q: '  abc  ', hasImage: '1', hasVideo: 'true' }), {
        q: 'abc',
        sort: 'newest',
        from: '',
        to: '',
        hasImage: true,
        hasVideo: true
    });
});

test('buildGridHash omits default values', function () {
    assert.equal(buildGridHash({ q: '', sort: 'newest' }), '#');
});

test('buildGridHash includes active filters', function () {
    assert.equal(
        buildGridHash({ q: 'ảnh đẹp', sort: 'relevance', from: '2026-04-01', hasImage: true }),
        '#search?q=%E1%BA%A3nh+%C4%91%E1%BA%B9p&sort=relevance&from=2026-04-01&img=1'
    );
});

test('parseHash handles detail routes with optional trailing slash', function () {
    assert.deepEqual(parseHash('#post/abc%20123/'), {
        view: 'detail',
        postId: 'abc 123',
        rawHash: '#post/abc%20123/'
    });
});

test('parseHash handles contact routes', function () {
    assert.deepEqual(parseHash('#contact'), {
        view: 'contact',
        rawHash: '#contact'
    });
});

test('parseHash handles grid search routes', function () {
    assert.deepEqual(parseHash('#search?q=test&sort=oldest&img=1'), {
        view: 'grid',
        params: {
            q: 'test',
            sort: 'oldest',
            from: '',
            to: '',
            hasImage: true,
            hasVideo: false
        },
        rawHash: '#search?q=test&sort=oldest&img=1'
    });
});

test('setHash pushes history without writing location.hash directly', function () {
    const previousLocation = globalThis.location;
    const previousHistory = globalThis.history;
    const previousWindow = globalThis.window;
    const previousHashChangeEvent = globalThis.HashChangeEvent;

    let pushedURL = null;
    let dispatchedType = null;

    globalThis.location = {
        pathname: '/',
        search: '',
        href: 'https://blog.fbaio.org/#post/123'
    };
    globalThis.history = {
        state: { ok: true },
        pushState(state, title, url) {
            pushedURL = url;
            globalThis.location.href = 'https://blog.fbaio.org' + url;
        },
        replaceState() {}
    };
    globalThis.HashChangeEvent = class HashChangeEvent {
        constructor(type, init) {
            this.type = type;
            this.oldURL = init.oldURL;
            this.newURL = init.newURL;
        }
    };
    globalThis.window = {
        dispatchEvent(event) {
            dispatchedType = event.type;
        }
    };

    try {
        setHash('#', false);
        assert.equal(pushedURL, '/#');
        assert.equal(dispatchedType, 'hashchange');
        assert.equal(globalThis.location.href, 'https://blog.fbaio.org/#');
    } finally {
        globalThis.location = previousLocation;
        globalThis.history = previousHistory;
        globalThis.window = previousWindow;
        globalThis.HashChangeEvent = previousHashChangeEvent;
    }
});
