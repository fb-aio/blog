import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGridHash, normalizeGridParams, parseHash } from '../src/utils/routing.js';

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
