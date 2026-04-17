import test from 'node:test';
import assert from 'node:assert/strict';

import { markdownToTitleText, truncateTitle } from '../src/utils/text.js';

test('truncateTitle prefers the first newline within max length', function () {
    assert.equal(truncateTitle('Dòng đầu\nDòng sau khá dài', 40), 'Dòng đầu');
});

test('truncateTitle prefers the first period within max length', function () {
    assert.equal(truncateTitle('Tiêu đề ngắn. Phần còn lại', 40), 'Tiêu đề ngắn');
});

test('markdownToTitleText strips markdown but preserves readable text', function () {
    assert.equal(
        markdownToTitleText('# **Xin chào** [FB AIO](https://example.com)'),
        'Xin chào   FB AIO'
    );
});
