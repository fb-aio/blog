import test from 'node:test';
import assert from 'node:assert/strict';

import { filterPosts, parsePostsCSV, sortPosts } from '../src/data/posts.js';

const POSTS = [
    {
        post_id: '1',
        message: 'Hướng dẫn ảnh đẹp\n\nẢnh và video',
        content_text: '',
        hashtags: '#fbaio_share',
        attachments: 'Photo:1,Video:2',
        creation_time: String(new Date('2026-04-10T10:00:00Z').getTime()),
        reactions: '3',
        comments: '9',
        shares: '1'
    },
    {
        post_id: '2',
        message: 'Mẹo automation\n\nText only',
        content_text: '',
        hashtags: '#automation',
        attachments: '',
        creation_time: String(new Date('2026-04-11T10:00:00Z').getTime()),
        reactions: '12',
        comments: '1',
        shares: '8'
    },
    {
        post_id: '3',
        message: 'Video walkthrough\n\nvideo demo',
        content_text: '',
        hashtags: '#video',
        attachments: 'Video:7',
        creation_time: String(new Date('2026-04-12T10:00:00Z').getTime()),
        reactions: '7',
        comments: '4',
        shares: '5'
    }
];

test('parsePostsCSV parses quoted values and escaped newlines', function () {
    const csv = 'post_id,message,thumbhash\n1,"Xin chào\\n\\nDòng 1\\nDòng 2","AQID"';
    assert.deepEqual(parsePostsCSV(csv), [
        {
            post_id: '1',
            message: 'Xin chào\n\nDòng 1\nDòng 2',
            thumbhash: 'AQID'
        }
    ]);
});

test('filterPosts applies query, date, and media filters', function () {
    const filtered = filterPosts(POSTS, 'anh dep', '2026-04-10', '2026-04-10', true, false);
    assert.deepEqual(filtered.map(function (post) { return post.post_id; }), ['1']);
});

test('filterPosts matches hashtags through the shared search haystack', function () {
    const filtered = filterPosts(POSTS, 'automation', '', '', false, false);
    assert.deepEqual(filtered.map(function (post) { return post.post_id; }), ['2']);
});

test('filterPosts matches post ids through the shared search haystack', function () {
    const filtered = filterPosts(POSTS, '2', '', '', false, false);
    assert.deepEqual(filtered.map(function (post) { return post.post_id; }), ['2']);
});

test('sortPosts sorts by oldest and newest deterministically', function () {
    assert.deepEqual(
        sortPosts(POSTS, 'oldest').map(function (post) { return post.post_id; }),
        ['1', '2', '3']
    );
    assert.deepEqual(
        sortPosts(POSTS, 'newest').map(function (post) { return post.post_id; }),
        ['3', '2', '1']
    );
});

test('sortPosts relevance prefers stronger matches and falls back to recency', function () {
    const sorted = sortPosts(POSTS, 'relevance', 'video');
    assert.deepEqual(sorted.map(function (post) { return post.post_id; }), ['3', '1', '2']);
});

test('sortPosts supports engagement-based ranking', function () {
    assert.deepEqual(
        sortPosts(POSTS, 'reactions').map(function (post) { return post.post_id; }),
        ['2', '3', '1']
    );
    assert.deepEqual(
        sortPosts(POSTS, 'comments').map(function (post) { return post.post_id; }),
        ['1', '3', '2']
    );
    assert.deepEqual(
        sortPosts(POSTS, 'shares').map(function (post) { return post.post_id; }),
        ['2', '3', '1']
    );
});

test('sortPosts supports best-post ranking by combined engagement', function () {
    assert.deepEqual(
        sortPosts(POSTS, 'engagement').map(function (post) { return post.post_id; }),
        ['2', '3', '1']
    );
});

test('sortPosts supports media-based ranking', function () {
    assert.deepEqual(
        sortPosts(POSTS, 'media').map(function (post) { return post.post_id; }),
        ['1', '3', '2']
    );
});
