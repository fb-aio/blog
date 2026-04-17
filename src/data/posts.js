import { IMAGE_EXTENSIONS, PLACEHOLDER_SVG } from '../config/constants.js';
import {
    escapeHtml,
    markdownToPlainText,
    markdownToTitleText,
    normalizeSearchText,
    truncate,
    truncateTitle
} from '../utils/text.js';

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }

    result.push(current.trim());
    return result;
}

export function parsePostsCSV(text) {
    const lines = text
        .replace(/\r\n/g, '\n')
        .replace(/\uFEFF/g, '')
        .split('\n')
        .filter(function (line) {
            return line.trim();
        });

    if (lines.length <= 1) return [];

    const header = parseCSVLine(lines[0]);
    return lines.slice(1).map(function (line) {
        const values = parseCSVLine(line);
        const post = {};

        header.forEach(function (key, index) {
            post[key.trim()] = (values[index] || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
        });

        return post;
    });
}

export function renderMarkdown(text) {
    if (!text) return '';
    if (globalThis.window?.marked?.parse) {
        return globalThis.window.marked.parse(String(text));
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
}

export function buildPostSearchHaystack(post) {
    return normalizeSearchText(
        [post.title || '', post.message || '', post.summary || '', post.content_text || ''].join(
            ' \n '
        )
    );
}

export function getPostSearchHaystack(post) {
    if (post._searchHaystack !== undefined) return post._searchHaystack;
    post._searchHaystack = buildPostSearchHaystack(post);
    return post._searchHaystack;
}

export function getPostTitleSearchText(post) {
    if (post._titleSearchText !== undefined) return post._titleSearchText;
    post._titleSearchText = normalizeSearchText(post.title || '');
    return post._titleSearchText;
}

export function getPostSummarySearchText(post) {
    if (post._summarySearchText !== undefined) return post._summarySearchText;
    post._summarySearchText = normalizeSearchText(post.summary || '');
    return post._summarySearchText;
}

export function getPostMessageSearchText(post) {
    if (post._messageSearchText !== undefined) return post._messageSearchText;
    post._messageSearchText = normalizeSearchText(post.message || '');
    return post._messageSearchText;
}

export function createQueryScorer(query) {
    const target = normalizeSearchText(query).trim();
    if (!target) return null;
    const matcher = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

    return function (post) {
        const scoreCache = post._queryScoreCache || (post._queryScoreCache = {});
        if (scoreCache[target] !== undefined) return scoreCache[target];

        const haystack = getPostSearchHaystack(post);
        const matches = haystack.match(matcher);
        const count = matches ? matches.length : 0;
        let bonus = 0;

        if (getPostTitleSearchText(post).indexOf(target) !== -1) bonus += 5;
        if (getPostSummarySearchText(post).indexOf(target) !== -1) bonus += 3;
        if (getPostMessageSearchText(post).indexOf(target) !== -1) bonus += 2;

        scoreCache[target] = count + bonus;
        return scoreCache[target];
    };
}

export function postHasImage(post) {
    if (post._hasImage !== undefined) return post._hasImage;
    post._hasImage = String(post.attachments || '').indexOf('Photo:') !== -1;
    return post._hasImage;
}

export function postHasVideo(post) {
    if (post._hasVideo !== undefined) return post._hasVideo;
    post._hasVideo = String(post.attachments || '').indexOf('Video:') !== -1;
    return post._hasVideo;
}

export function filterPosts(posts, q, dateFrom, dateTo, hasImage, hasVideo) {
    const normalizedQuery = normalizeSearchText(q).trim();
    const fromTs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : null;
    const toTs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : null;

    return posts.filter(function (post) {
        const timestamp = Number(post.creation_time || 0);
        if (fromTs && timestamp < fromTs) return false;
        if (toTs && timestamp > toTs) return false;
        if (hasImage && !postHasImage(post)) return false;
        if (hasVideo && !postHasVideo(post)) return false;
        if (!normalizedQuery) return true;
        return getPostSearchHaystack(post).indexOf(normalizedQuery) !== -1;
    });
}

export function sortPosts(posts, sort, q) {
    if (sort === 'oldest') {
        return posts.slice().sort(function (a, b) {
            return Number(a.creation_time) - Number(b.creation_time);
        });
    }

    if (sort === 'relevance' && q) {
        const scoreForPost = createQueryScorer(q);
        if (!scoreForPost) {
            return posts.slice().sort(function (a, b) {
                return Number(b.creation_time) - Number(a.creation_time);
            });
        }

        return posts.slice().sort(function (a, b) {
            const scoreDelta = scoreForPost(b) - scoreForPost(a);
            if (scoreDelta !== 0) return scoreDelta;
            return Number(b.creation_time) - Number(a.creation_time);
        });
    }

    return posts.slice().sort(function (a, b) {
        return Number(b.creation_time) - Number(a.creation_time);
    });
}

function getPrimaryPostText(post) {
    return markdownToPlainText(post.content_text || post.message || post.summary || post.title || '');
}

export function getPostCopy(post) {
    if (post._copy) return post._copy;

    const primarySource = post.content_text || post.message || post.summary || post.title || '';
    const titleSource = markdownToTitleText(primarySource) || markdownToTitleText(post.title || '');
    const source = getPrimaryPostText(post) || markdownToPlainText(post.title || '');
    const backup = markdownToPlainText(
        [post.summary || '', post.message || '', post.content_text || '', post.title || ''].join(' ')
    );

    if (!source) {
        post._copy = {
            title: 'Untitled',
            excerpt: 'Không có mô tả ngắn cho bài viết này.'
        };
        return post._copy;
    }

    const title = truncateTitle(titleSource || source, 72) || truncate(source, 72) || 'Untitled';
    const titlePlain = title.replace(/…$/, '');
    const remainder = source
        .slice(Math.min(source.length, titlePlain.length))
        .trim()
        .replace(/^[\s,.;:!?-]+/, '');
    let excerpt = truncate(remainder || source, 180);

    if (excerpt === title) {
        excerpt = truncate(
            backup.slice(Math.min(backup.length, titlePlain.length)).trim() ||
                backup ||
                'Không có mô tả ngắn cho bài viết này.',
            180
        );
    }

    post._copy = { title, excerpt };
    return post._copy;
}

export function getPostTitle(post) {
    return getPostCopy(post).title;
}

export function getPostExcerpt(post) {
    return getPostCopy(post).excerpt;
}

export function allMedia(post) {
    if (post._mediaList) return post._mediaList;

    const seen = new Set();
    post._mediaList = String(post.attachments || '')
        .split(',')
        .map(function (token) {
            return token.trim();
        })
        .filter(function (token) {
            return token && !seen.has(token) && seen.add(token);
        })
        .map(function (token) {
            const parts = token.split(':');
            const type = parts[0];
            const id = parts[1];
            const base = 'media/' + post.post_id + '_' + id + '.';
            const candidates =
                type === 'Video'
                    ? [base + 'mp4']
                    : IMAGE_EXTENSIONS.map(function (ext) {
                          return base + ext;
                      });

            return {
                type,
                id,
                candidates,
                url: candidates[0]
            };
        });

    return post._mediaList;
}

export function mediaUrl(post) {
    if (post._cover !== undefined) return post._cover;
    const media = allMedia(post);
    post._cover = media.length > 0 ? media[0] : null;
    return post._cover;
}

export function mediaSummary(post) {
    if (post._mediaSummary !== undefined) return post._mediaSummary;

    const media = allMedia(post);
    if (media.length === 0) {
        post._mediaSummary = null;
        return post._mediaSummary;
    }

    const photos = media.filter(function (item) {
        return item.type !== 'Video';
    }).length;
    const videos = media.filter(function (item) {
        return item.type === 'Video';
    }).length;
    const parts = [];

    if (photos) parts.push(photos + ' ảnh');
    if (videos) parts.push(videos + ' video');

    post._mediaSummary = {
        total: media.length,
        label: parts.join(' • ')
    };
    return post._mediaSummary;
}

export function enrichPost(post) {
    if (!post) return post;
    postHasImage(post);
    postHasVideo(post);
    getPostSearchHaystack(post);
    getPostTitleSearchText(post);
    getPostSummarySearchText(post);
    getPostMessageSearchText(post);
    getPostCopy(post);
    mediaSummary(post);
    mediaUrl(post);
    return post;
}

export function handleImageFallback(event, candidates) {
    const element = event.target;
    const nextIndex = Number(element.dataset.fallbackIndex || '0') + 1;

    if (nextIndex < candidates.length) {
        element.dataset.fallbackIndex = String(nextIndex);
        element.src = candidates[nextIndex];
        return;
    }

    element.onerror = null;
    element.src = PLACEHOLDER_SVG;
}
