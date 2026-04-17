import test from 'node:test';
import assert from 'node:assert/strict';

import { filterPosts, parsePostsCSV, sortPosts } from '../src/data/posts.js';

const POSTS = [
    {
        post_id: '1',
        title: 'Hướng dẫn ảnh đẹp',
        summary: 'Tổng hợp',
        message: 'Ảnh và video',
        content_text: '',
        attachments: 'Photo:1,Video:2',
        creation_time: String(new Date('2026-04-10T10:00:00Z').getTime())
    },
    {
        post_id: '2',
        title: 'Mẹo automation',
        summary: 'Không có media',
        message: 'Text only',
        content_text: '',
        attachments: '',
        creation_time: String(new Date('2026-04-11T10:00:00Z').getTime())
    },
    {
        post_id: '3',
        title: 'Video walkthrough',
        summary: 'Chỉ có video',
        message: 'video demo',
        content_text: '',
        attachments: 'Video:7',
        creation_time: String(new Date('2026-04-12T10:00:00Z').getTime())
    }
];

test('parsePostsCSV parses quoted values and escaped newlines', function () {
    const csv = 'post_id,title,message\n1,"Xin chào","Dòng 1\\nDòng 2"';
    assert.deepEqual(parsePostsCSV(csv), [
        {
            post_id: '1',
            title: 'Xin chào',
            message: 'Dòng 1\nDòng 2'
        }
    ]);
});

test('filterPosts applies query, date, and media filters', function () {
    const filtered = filterPosts(POSTS, 'anh dep', '2026-04-10', '2026-04-10', true, false);
    assert.deepEqual(filtered.map(function (post) { return post.post_id; }), ['1']);
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
