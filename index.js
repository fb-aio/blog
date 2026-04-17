(function () {
    'use strict';

    var useEffect = hooks.useEffect;
    var useMemo = hooks.useMemo;
    var useRef = hooks.useRef;
    var useState = hooks.useState;

    var PLACEHOLDER_SVG =
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 480%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%23f4e4d0%22/%3E%3Cstop offset=%221%22 stop-color=%22%23dce6e3%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill=%22url(%23g)%22 width=%22640%22 height=%22480%22/%3E%3Ccircle cx=%22560%22 cy=%2280%22 r=%2270%22 fill=%22rgba(219,92,68,0.22)%22/%3E%3Ccircle cx=%2290%22 cy=%22380%22 r=%2290%22 fill=%22rgba(15,118,110,0.18)%22/%3E%3Ctext fill=%22%235d6777%22 font-family=%22Instrument Sans, Arial, sans-serif%22 font-size=%2224%22 x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3ENo media preview%3C/text%3E%3C/svg%3E';
    var GRID_STATE_KEY = 'fb-aio-blog:grid-state:v2';
    var GRID_BATCH_SIZE = 18;
    var IMAGE_EXTENSIONS = ['jpg', 'png', 'jpeg', 'webp'];
    var IMAGE_VIEWER_MIN_SCALE = 1;
    var IMAGE_VIEWER_MAX_SCALE = 4;
    var SNAPSHOT_SCROLL_THROTTLE_MS = 200;

    var ALL_POSTS = [];
    var POSTS_BY_ID = {};
    var POSTS_LOADED = false;
    var POSTS_ERROR = null;
    var LATEST_POST_TS = 0;

    if (window.marked && window.marked.setOptions) {
        window.marked.setOptions({
            gfm: true,
            breaks: true
        });
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
    }

    function safeParseJSON(raw) {
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function readGridSnapshot() {
        try {
            return safeParseJSON(sessionStorage.getItem(GRID_STATE_KEY));
        } catch (error) {
            return null;
        }
    }

    function writeGridSnapshot(snapshot) {
        try {
            sessionStorage.setItem(GRID_STATE_KEY, JSON.stringify(snapshot));
        } catch (error) {
            return null;
        }
        return snapshot;
    }

    function parseCSVLine(line) {
        var result = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
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

    function parsePostsCSV(text) {
        var lines = text
            .replace(/\r\n/g, '\n')
            .replace(/\uFEFF/g, '')
            .split('\n')
            .filter(function (line) {
                return line.trim();
            });

        if (lines.length <= 1) return [];

        var header = parseCSVLine(lines[0]);
        return lines.slice(1).map(function (line) {
            var values = parseCSVLine(line);
            var post = {};

            header.forEach(function (key, index) {
                post[key.trim()] = (values[index] || '')
                    .replace(/^"|"$/g, '')
                    .replace(/\\n/g, '\n');
            });

            return post;
        });
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeSearchText(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase();
    }

    function buildSearchIndex(text) {
        var source = String(text || '');
        var normalized = '';
        var indexMap = [];

        for (var i = 0; i < source.length; i++) {
            var folded = source[i]
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .replace(/Đ/g, 'D')
                .toLowerCase();

            for (var j = 0; j < folded.length; j++) {
                normalized += folded[j];
                indexMap.push(i);
            }
        }

        return {
            source: source,
            normalized: normalized,
            indexMap: indexMap
        };
    }

    function highlightText(text, term) {
        var source = String(text || '');
        if (!term) return escapeHtml(source);

        var normalizedTerm = normalizeSearchText(term).trim();
        if (!normalizedTerm) return escapeHtml(source);

        var searchIndex = buildSearchIndex(source);
        var ranges = [];
        var cursor = 0;

        while (cursor < searchIndex.normalized.length) {
            var start = searchIndex.normalized.indexOf(normalizedTerm, cursor);
            if (start === -1) break;

            var end = start + normalizedTerm.length - 1;
            var originalStart = searchIndex.indexMap[start];
            var originalEnd = searchIndex.indexMap[end] + 1;
            var previous = ranges[ranges.length - 1];

            if (previous && originalStart <= previous[1]) {
                previous[1] = Math.max(previous[1], originalEnd);
            } else {
                ranges.push([originalStart, originalEnd]);
            }

            cursor = start + normalizedTerm.length;
        }

        if (!ranges.length) return escapeHtml(source);

        var output = '';
        var lastIndex = 0;

        ranges.forEach(function (range) {
            output += escapeHtml(source.slice(lastIndex, range[0]));
            output += '<mark>' + escapeHtml(source.slice(range[0], range[1])) + '</mark>';
            lastIndex = range[1];
        });

        output += escapeHtml(source.slice(lastIndex));
        return output;
    }

    function truncate(text, maxLength) {
        var normalized = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (normalized.length <= maxLength) return normalized;

        var candidate = normalized.slice(0, maxLength + 1);
        var lastSpace = candidate.lastIndexOf(' ');

        if (lastSpace > Math.floor(maxLength * 0.6)) {
            candidate = candidate.slice(0, lastSpace);
        } else {
            candidate = normalized.slice(0, maxLength);
        }

        return candidate.replace(/[\s,.;:!?-]+$/, '').trim() + '…';
    }

    function getViewerTransformState() {
        return {
            scale: 1,
            x: 0,
            y: 0,
            isDragging: false
        };
    }

    function getTouchDistance(firstTouch, secondTouch) {
        var deltaX = firstTouch.clientX - secondTouch.clientX;
        var deltaY = firstTouch.clientY - secondTouch.clientY;
        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    function getTouchMidpoint(firstTouch, secondTouch) {
        return {
            clientX: (firstTouch.clientX + secondTouch.clientX) / 2,
            clientY: (firstTouch.clientY + secondTouch.clientY) / 2
        };
    }

    function clampViewerOffset(scale, x, y, stageElement, imageElement) {
        if (!stageElement || !imageElement || scale <= 1) {
            return { x: 0, y: 0 };
        }

        var maxX = Math.max(0, (imageElement.clientWidth * scale - stageElement.clientWidth) / 2);
        var maxY = Math.max(0, (imageElement.clientHeight * scale - stageElement.clientHeight) / 2);

        return {
            x: clamp(x, -maxX, maxX),
            y: clamp(y, -maxY, maxY)
        };
    }

    function truncateTitle(text, maxLength) {
        var normalized = String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(function (line) {
                return line.replace(/\s+/g, ' ').trim();
            })
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        if (!normalized) return '';

        var firstNewline = normalized.indexOf('\n');
        var firstPeriod = normalized.indexOf('.');
        var cutIndex = -1;

        if (firstNewline !== -1 && firstNewline <= maxLength) {
            cutIndex = firstNewline;
        }

        if (firstPeriod !== -1 && firstPeriod < maxLength) {
            cutIndex = cutIndex === -1 ? firstPeriod + 1 : Math.min(cutIndex, firstPeriod + 1);
        }

        if (cutIndex !== -1) {
            return normalized
                .slice(0, cutIndex)
                .replace(/[\s,.;:!?-]+$/, '')
                .trim();
        }

        return truncate(normalized.replace(/\n+/g, ' '), maxLength);
    }

    function formatDate(unixMs) {
        return new Date(Number(unixMs)).toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatDateShort(unixMs) {
        return new Date(Number(unixMs)).toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    function normalizeGridParams(params) {
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

    function buildGridHash(params) {
        var normalized = normalizeGridParams(params);
        var qs = new URLSearchParams();

        if (normalized.q) qs.set('q', normalized.q);
        if (normalized.sort && normalized.sort !== 'newest') qs.set('sort', normalized.sort);
        if (normalized.from) qs.set('from', normalized.from);
        if (normalized.to) qs.set('to', normalized.to);
        if (normalized.hasImage) qs.set('img', '1');
        if (normalized.hasVideo) qs.set('video', '1');

        return qs.toString() ? '#search?' + qs.toString() : '#';
    }

    function parseHash() {
        var rawHash = location.hash || '#';
        var trimmed = rawHash.replace(/^#/, '');
        var detailMatch = trimmed.match(/^post\/([^/]+)\/?$/);

        if (detailMatch) {
            return {
                view: 'detail',
                postId: decodeURIComponent(detailMatch[1]),
                rawHash: rawHash
            };
        }

        var params = normalizeGridParams({});
        if (trimmed.indexOf('search?') === 0) {
            var searchParams = new URLSearchParams(trimmed.slice(7));
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
            params: params,
            rawHash: buildGridHash(params)
        };
    }

    function setHash(hash, replace) {
        var nextHash = hash || '#';
        var url = location.pathname + location.search + nextHash;
        if (replace) {
            history.replaceState(history.state, '', url);
        } else {
            location.hash = nextHash.slice(1);
        }
    }

    function buildSnapshotFromGridParams(params, visibleCount, scrollY) {
        var normalized = normalizeGridParams(params || {});
        return {
            q: normalized.q,
            sort: normalized.sort,
            from: normalized.from,
            to: normalized.to,
            hasImage: normalized.hasImage,
            hasVideo: normalized.hasVideo,
            visibleCount: Math.max(Number(visibleCount || 0), GRID_BATCH_SIZE),
            scrollY: scrollY !== undefined ? scrollY : window.scrollY,
            hash: buildGridHash(normalized),
            updatedAt: Date.now()
        };
    }

    function buildSnapshotFromState(state, overrides) {
        var params = normalizeGridParams({
            q: overrides && overrides.q !== undefined ? overrides.q : state.q,
            sort: overrides && overrides.sort !== undefined ? overrides.sort : state.sort,
            from: overrides && overrides.from !== undefined ? overrides.from : state.dateFrom,
            to: overrides && overrides.to !== undefined ? overrides.to : state.dateTo,
            hasImage:
                overrides && overrides.hasImage !== undefined ? overrides.hasImage : state.hasImage,
            hasVideo:
                overrides && overrides.hasVideo !== undefined ? overrides.hasVideo : state.hasVideo
        });

        return buildSnapshotFromGridParams(
            params,
            overrides && overrides.visibleCount !== undefined
                ? overrides.visibleCount
                : state.visibleCount,
            overrides && overrides.scrollY !== undefined ? overrides.scrollY : window.scrollY
        );
    }

    function markdownToPlainText(text) {
        var source = String(text || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*>+\s?/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/[*_~]/g, ' ')
            .replace(/\|/g, ' ')
            .replace(/\n+/g, ' ');

        return source.replace(/\s+/g, ' ').trim();
    }

    function markdownToTitleText(text) {
        return String(text || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*>+\s?/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/[*_~]/g, ' ')
            .replace(/\|/g, ' ')
            .trim();
    }

    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked && window.marked.parse) {
            return window.marked.parse(String(text));
        }
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    function buildPostSearchHaystack(post) {
        return normalizeSearchText(
            [post.title || '', post.message || '', post.summary || '', post.content_text || ''].join(
                ' \n '
            )
        );
    }

    function getPostSearchHaystack(post) {
        if (post._searchHaystack !== undefined) return post._searchHaystack;
        post._searchHaystack = buildPostSearchHaystack(post);
        return post._searchHaystack;
    }

    function getPostTitleSearchText(post) {
        if (post._titleSearchText !== undefined) return post._titleSearchText;
        post._titleSearchText = normalizeSearchText(post.title || '');
        return post._titleSearchText;
    }

    function getPostSummarySearchText(post) {
        if (post._summarySearchText !== undefined) return post._summarySearchText;
        post._summarySearchText = normalizeSearchText(post.summary || '');
        return post._summarySearchText;
    }

    function getPostMessageSearchText(post) {
        if (post._messageSearchText !== undefined) return post._messageSearchText;
        post._messageSearchText = normalizeSearchText(post.message || '');
        return post._messageSearchText;
    }

    function createQueryScorer(query) {
        var target = normalizeSearchText(query).trim();
        if (!target) return null;
        var matcher = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

        return function (post) {
            var scoreCache = post._queryScoreCache || (post._queryScoreCache = {});
            if (scoreCache[target] !== undefined) return scoreCache[target];

            var haystack = getPostSearchHaystack(post);
            var matches = haystack.match(matcher);
            var count = matches ? matches.length : 0;
            var bonus = 0;

            if (getPostTitleSearchText(post).indexOf(target) !== -1) bonus += 5;
            if (getPostSummarySearchText(post).indexOf(target) !== -1) bonus += 3;
            if (getPostMessageSearchText(post).indexOf(target) !== -1) bonus += 2;

            scoreCache[target] = count + bonus;
            return scoreCache[target];
        };
    }

    function postHasImage(post) {
        if (post._hasImage !== undefined) return post._hasImage;
        post._hasImage = String(post.attachments || '').indexOf('Photo:') !== -1;
        return post._hasImage;
    }

    function postHasVideo(post) {
        if (post._hasVideo !== undefined) return post._hasVideo;
        post._hasVideo = String(post.attachments || '').indexOf('Video:') !== -1;
        return post._hasVideo;
    }

    function filterPosts(posts, q, dateFrom, dateTo, hasImage, hasVideo) {
        var normalizedQuery = normalizeSearchText(q).trim();
        var fromTs = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : null;
        var toTs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : null;

        return posts.filter(function (post) {
            var timestamp = Number(post.creation_time || 0);
            if (fromTs && timestamp < fromTs) return false;
            if (toTs && timestamp > toTs) return false;
            if (hasImage && !postHasImage(post)) return false;
            if (hasVideo && !postHasVideo(post)) return false;

            if (!normalizedQuery) return true;

            return getPostSearchHaystack(post).indexOf(normalizedQuery) !== -1;
        });
    }

    function sortPosts(posts, sort, q) {
        if (sort === 'oldest') {
            return posts.slice().sort(function (a, b) {
                return Number(a.creation_time) - Number(b.creation_time);
            });
        }

        if (sort === 'relevance' && q) {
            var scoreForPost = createQueryScorer(q);
            if (!scoreForPost) {
                return posts.slice().sort(function (a, b) {
                    return Number(b.creation_time) - Number(a.creation_time);
                });
            }

            return posts.slice().sort(function (a, b) {
                var scoreDelta = scoreForPost(b) - scoreForPost(a);
                if (scoreDelta !== 0) return scoreDelta;
                return Number(b.creation_time) - Number(a.creation_time);
            });
        }

        return posts.slice().sort(function (a, b) {
            return Number(b.creation_time) - Number(a.creation_time);
        });
    }

    function getPrimaryPostText(post) {
        return markdownToPlainText(
            post.content_text || post.message || post.summary || post.title || ''
        );
    }

    function getPostCopy(post) {
        if (post._copy) return post._copy;

        var primarySource = post.content_text || post.message || post.summary || post.title || '';
        var titleSource =
            markdownToTitleText(primarySource) || markdownToTitleText(post.title || '');
        var source = getPrimaryPostText(post) || markdownToPlainText(post.title || '');
        var backup = markdownToPlainText(
            [
                post.summary || '',
                post.message || '',
                post.content_text || '',
                post.title || ''
            ].join(' ')
        );
        if (!source) {
            post._copy = {
                title: 'Untitled',
                excerpt: 'Không có mô tả ngắn cho bài viết này.'
            };
            return post._copy;
        }

        var title = truncateTitle(titleSource || source, 72) || truncate(source, 72) || 'Untitled';
        var titlePlain = title.replace(/…$/, '');
        var remainder = source
            .slice(Math.min(source.length, titlePlain.length))
            .trim()
            .replace(/^[\s,.;:!?-]+/, '');
        var excerpt = truncate(remainder || source, 180);

        if (excerpt === title) {
            excerpt = truncate(
                backup.slice(Math.min(backup.length, titlePlain.length)).trim() ||
                    backup ||
                    'Không có mô tả ngắn cho bài viết này.',
                180
            );
        }

        post._copy = {
            title: title,
            excerpt: excerpt
        };
        return post._copy;
    }

    function getPostTitle(post) {
        return getPostCopy(post).title;
    }

    function getPostExcerpt(post) {
        return getPostCopy(post).excerpt;
    }

    function allMedia(post) {
        if (post._mediaList) return post._mediaList;

        var seen = new Set();
        post._mediaList = String(post.attachments || '')
            .split(',')
            .map(function (token) {
                return token.trim();
            })
            .filter(function (token) {
                return token && !seen.has(token) && seen.add(token);
            })
            .map(function (token) {
                var parts = token.split(':');
                var type = parts[0];
                var id = parts[1];
                var base = 'media/' + post.post_id + '_' + id + '.';
                var candidates =
                    type === 'Video'
                        ? [base + 'mp4']
                        : IMAGE_EXTENSIONS.map(function (ext) {
                              return base + ext;
                          });

                return {
                    type: type,
                    id: id,
                    candidates: candidates,
                    url: candidates[0]
                };
            });
        return post._mediaList;
    }

    function mediaUrl(post) {
        if (post._cover !== undefined) return post._cover;
        var media = allMedia(post);
        post._cover = media.length > 0 ? media[0] : null;
        return post._cover;
    }

    function mediaSummary(post) {
        if (post._mediaSummary !== undefined) return post._mediaSummary;

        var media = allMedia(post);
        if (media.length === 0) {
            post._mediaSummary = null;
            return post._mediaSummary;
        }

        var photos = media.filter(function (item) {
            return item.type !== 'Video';
        }).length;
        var videos = media.filter(function (item) {
            return item.type === 'Video';
        }).length;
        var parts = [];

        if (photos) parts.push(photos + ' ảnh');
        if (videos) parts.push(videos + ' video');

        post._mediaSummary = {
            total: media.length,
            label: parts.join(' • ')
        };
        return post._mediaSummary;
    }

    function enrichPost(post) {
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

    function handleImageFallback(event, candidates) {
        var element = event.target;
        var nextIndex = Number(element.dataset.fallbackIndex || '0') + 1;

        if (nextIndex < candidates.length) {
            element.dataset.fallbackIndex = String(nextIndex);
            element.src = candidates[nextIndex];
            return;
        }

        element.onerror = null;
        element.src = PLACEHOLDER_SVG;
    }

    var lazyObserver = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var element = entry.target;
                if (element.dataset.src) {
                    element.src = element.dataset.src;
                    element.onload = function () {
                        element.classList.add('fade-in');
                    };
                }
                lazyObserver.unobserve(element);
            });
        },
        {
            rootMargin: '220px'
        }
    );

    function Header(props) {
        return html`
            <header class="hero-shell">
                <div class="hero-orb hero-orb-one"></div>
                <div class="hero-orb hero-orb-two"></div>

                <div class="max-w-7xl mx-auto px-4 pt-6 pb-7 sm:pt-8 sm:pb-8">
                    <div class="flex items-center justify-between gap-3">
                        <button
                            class="pill-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                            onClick=${props.onHome}
                        >
                            <i
                                class="fa-solid fa-house-chimney text-[0.82rem]"
                                aria-hidden="true"
                            ></i>
                            <span>FB AIO Blog</span>
                        </button>

                        <button
                            class="theme-toggle inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                            aria-label="Toggle theme"
                            onClick=${props.onToggleTheme}
                        >
                            <i
                                class=${props.isDark
                                    ? 'fa-solid fa-sun text-[0.82rem]'
                                    : 'fa-solid fa-moon text-[0.82rem]'}
                                aria-hidden="true"
                            ></i>
                            <span>${props.isDark ? 'Sáng' : 'Tối'}</span>
                        </button>
                    </div>

                    <div
                        class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(250px,0.7fr)] lg:items-end"
                    >
                        <div>
                            <div class="eyebrow">Archive</div>
                            <h1
                                class="display-font text-[clamp(2.2rem,5vw,3.5rem)] leading-[0.95] mt-2 mb-3"
                            >
                                FB AIO Blog
                            </h1>
                            <p class="hero-copy">
                                Chỗ để lướt lại các bài viết, ghi chú và mẹo dùng FB AIO. Tìm nhanh
                                thứ bạn cần, thấy bài nào hay thì mở ra đọc sâu hơn.
                            </p>
                        </div>

                        <div
                            class="glass-panel panel-strong rounded-[1.4rem] p-3 sm:p-4"
                            style="box-shadow: var(--hero-shadow);"
                        >
                            <div class="grid grid-cols-2 gap-3">
                                <div class="stat-card">
                                    <span class="stat-label">Tổng bài viết</span>
                                    <strong class="stat-value"
                                        >${formatNumber(props.totalCount)}</strong
                                    >
                                </div>
                                <div class="stat-card">
                                    <span class="stat-label">Bài mới nhất</span>
                                    <strong class="stat-value"
                                        >${props.latestTs
                                            ? formatDateShort(props.latestTs)
                                            : '...'}</strong
                                    >
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>
        `;
    }

    function DetailTopbar(props) {
        return html`
            <div class="detail-topbar">
                <div class="max-w-7xl mx-auto px-4">
                    <div class="glass-panel detail-topbar-shell rounded-[1.2rem] px-3 py-3 sm:px-4">
                        <button
                            class="pill-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                            onClick=${props.onBack}
                        >
                            <i class="fa-solid fa-arrow-left text-[0.82rem]" aria-hidden="true"></i>
                            <span>Quay lại</span>
                        </button>

                        <button
                            class="detail-brand"
                            aria-label="Về trang chủ FB AIO Blog"
                            onClick=${props.onHome}
                        >
                            <img src="./logo.png" alt="" class="detail-brand-logo" />
                            <span class="detail-brand-copy">
                                <strong>FB AIO Blog</strong>
                                <span>Archive</span>
                            </span>
                        </button>

                        <button
                            class="theme-toggle inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                            onClick=${props.onToggleTheme}
                        >
                            <i
                                class=${props.isDark
                                    ? 'fa-solid fa-sun text-[0.82rem]'
                                    : 'fa-solid fa-moon text-[0.82rem]'}
                                aria-hidden="true"
                            ></i>
                            <span>${props.isDark ? 'Sáng' : 'Tối'}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function FilterBar(props) {
        var _draft = useState(props.q || '');
        var draftQuery = _draft[0];
        var setDraftQuery = _draft[1];
        var _collapsed = useState(false);
        var filtersCollapsed = _collapsed[0];
        var setFiltersCollapsed = _collapsed[1];
        var _open = useState(
            !!(
                props.dateFrom ||
                props.dateTo ||
                props.sort !== 'newest' ||
                props.hasImage ||
                props.hasVideo
            )
        );
        var filtersOpen = _open[0];
        var setFiltersOpen = _open[1];
        var canUseRelevance = !!props.q;

        useEffect(
            function () {
                setDraftQuery(props.q || '');
            },
            [props.q]
        );

        useEffect(
            function () {
                if (
                    props.dateFrom ||
                    props.dateTo ||
                    props.sort !== 'newest' ||
                    props.hasImage ||
                    props.hasVideo
                ) {
                    setFiltersOpen(true);
                }
            },
            [props.dateFrom, props.dateTo, props.sort, props.hasImage, props.hasVideo]
        );

        useEffect(
            function () {
                if (draftQuery === (props.q || '')) return;

                var timer = window.setTimeout(function () {
                    props.onSearch(draftQuery);
                }, 180);

                return function () {
                    window.clearTimeout(timer);
                };
            },
            [draftQuery, props.q, props.onSearch]
        );

        var chips = [];
        if (props.q)
            chips.push(
                html`<span class="chip"><span>Search</span><strong>${props.q}</strong></span>`
            );
        if (props.dateFrom)
            chips.push(
                html`<span class="chip"><span>Từ</span><strong>${props.dateFrom}</strong></span>`
            );
        if (props.dateTo)
            chips.push(
                html`<span class="chip"><span>Đến</span><strong>${props.dateTo}</strong></span>`
            );
        if (props.sort !== 'newest')
            chips.push(
                html`<span class="chip"><span>Sắp xếp</span><strong>${props.sort}</strong></span>`
            );
        if (props.hasImage)
            chips.push(html`<span class="chip"><span>Media</span><strong>Có ảnh</strong></span>`);
        if (props.hasVideo)
            chips.push(html`<span class="chip"><span>Media</span><strong>Có video</strong></span>`);

        var filterCardClass =
            'glass-panel filter-card filter-floating-card' +
            (filtersCollapsed ? ' filter-floating-card-hidden' : '');
        var collapsedButtonClass =
            'glass-panel filter-collapsed-button ' +
            (filtersCollapsed
                ? 'filter-collapsed-button-visible'
                : 'filter-collapsed-button-hidden');
        var filterPanelPopoverClass =
            'glass-panel panel-strong filter-panel-popover ' +
            (filtersOpen && !filtersCollapsed
                ? 'filter-panel-popover-open'
                : 'filter-panel-popover-closed');
        var hasActiveChips = chips.length > 0;
        var showSummaryChips = hasActiveChips && !filtersCollapsed && !filtersOpen;

        return html`
            <div class="filter-stack">
                <section class="filter-floating-shell">
                    <div class="max-w-7xl mx-auto">
                        <div class="filter-dock">
                            <button
                                class=${collapsedButtonClass}
                                aria-label="Mở tìm kiếm và bộ lọc"
                                onClick=${function () {
                                    setFiltersCollapsed(false);
                                }}
                            >
                                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                                <span class="filter-collapsed-label">Tìm kiếm bài viết</span>
                            </button>

                            <div class=${filterCardClass}>
                                <div class="filter-toolbar">
                                    <div class="search-shell">
                                        <span class="search-icon" aria-hidden="true">
                                            <i class="fa-solid fa-magnifying-glass"></i>
                                        </span>
                                        <input
                                            type="text"
                                            value=${draftQuery}
                                            placeholder="Tìm bài muốn đọc..."
                                            onInput=${function (event) {
                                                setDraftQuery(event.target.value);
                                            }}
                                        />
                                        ${draftQuery
                                            ? html` <button
                                                  class="clear-search"
                                                  aria-label="Clear search"
                                                  onClick=${function () {
                                                      setDraftQuery('');
                                                      props.onSearch('');
                                                  }}
                                              >
                                                  <i
                                                      class="fa-solid fa-xmark"
                                                      aria-hidden="true"
                                                  ></i>
                                              </button>`
                                            : ''}
                                    </div>

                                    <button
                                        class="pill-button filter-toggle inline-flex items-center justify-center gap-2"
                                        onClick=${function () {
                                            setFiltersOpen(!filtersOpen);
                                        }}
                                    >
                                        <i
                                            class="fa-solid fa-sliders text-[0.78rem]"
                                            aria-hidden="true"
                                        ></i>
                                        <span>${filtersOpen ? 'Ẩn lọc' : 'Bộ lọc'}</span>
                                    </button>

                                    <button
                                        class="pill-button filter-collapse-button inline-flex items-center justify-center"
                                        aria-label="Thu gọn thanh tìm kiếm và bộ lọc"
                                        onClick=${function () {
                                            setFiltersCollapsed(true);
                                        }}
                                    >
                                        <i
                                            class="fa-solid fa-chevron-up text-[0.78rem]"
                                            aria-hidden="true"
                                        ></i>
                                    </button>
                                </div>

                                <div class="filter-toolbar-meta">
                                    <p
                                        class="result-summary result-summary-inline m-0"
                                        aria-live="polite"
                                    >
                                        <span>Tìm thấy</span>
                                        <strong>${formatNumber(props.filteredCount)}</strong>
                                        <span>/</span>
                                        <strong>${formatNumber(props.totalCount)}</strong>
                                        <span>bài viết.</span>
                                    </p>
                                </div>

                                ${showSummaryChips
                                    ? html` <div class="filter-summary-shell">
                                          <div class="filter-summary-content mt-2">
                                              <div class="flex flex-wrap gap-2">
                                                  ${chips}
                                                  <button
                                                      class="chip chip-action"
                                                      onClick=${props.onClear}
                                                  >
                                                      <i
                                                          class="fa-solid fa-rotate-left text-[0.76rem]"
                                                          aria-hidden="true"
                                                      ></i>
                                                      <span>Reset</span>
                                                  </button>
                                              </div>
                                          </div>
                                      </div>`
                                    : ''}

                                <div
                                    class=${filterPanelPopoverClass}
                                    aria-hidden=${!filtersOpen || filtersCollapsed}
                                >
                                    <div class="filter-panel">
                                        <div
                                            class="mini-grid md:grid-cols-[150px_repeat(2,minmax(0,1fr))] md:grid"
                                        >
                                            <label class="block">
                                                <span
                                                    class="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] mb-2"
                                                    >Sắp xếp</span
                                                >
                                                <select
                                                    class="field-select"
                                                    value=${props.sort}
                                                    onChange=${function (event) {
                                                        props.onSort(event.target.value);
                                                    }}
                                                >
                                                    <option value="newest">Mới nhất</option>
                                                    <option value="oldest">Cũ nhất</option>
                                                    <option
                                                        value="relevance"
                                                        disabled=${!canUseRelevance}
                                                    >
                                                        Relevance
                                                    </option>
                                                </select>
                                            </label>

                                            <label class="block">
                                                <span
                                                    class="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] mb-2"
                                                    >Từ ngày</span
                                                >
                                                <input
                                                    class="field-input"
                                                    type="date"
                                                    value=${props.dateFrom}
                                                    onChange=${function (event) {
                                                        props.onDateFrom(event.target.value);
                                                    }}
                                                />
                                            </label>

                                            <label class="block">
                                                <span
                                                    class="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] mb-2"
                                                    >Đến ngày</span
                                                >
                                                <input
                                                    class="field-input"
                                                    type="date"
                                                    value=${props.dateTo}
                                                    onChange=${function (event) {
                                                        props.onDateTo(event.target.value);
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        <div>
                                            <span
                                                class="block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)] mb-2"
                                                ><i
                                                    class="fa-solid fa-photo-film mr-1.5 text-[0.75rem]"
                                                    aria-hidden="true"
                                                ></i
                                                >Media</span
                                            >
                                            <div class="media-toggle-row">
                                                <button
                                                    class=${'toggle-chip inline-flex items-center gap-2 ' +
                                                    (props.hasImage ? 'toggle-chip-active' : '')}
                                                    onClick=${props.onToggleImage}
                                                >
                                                    <i
                                                        class="fa-regular fa-image text-[0.82rem]"
                                                        aria-hidden="true"
                                                    ></i>
                                                    <span>Có ảnh</span>
                                                </button>
                                                <button
                                                    class=${'toggle-chip inline-flex items-center gap-2 ' +
                                                    (props.hasVideo ? 'toggle-chip-active' : '')}
                                                    onClick=${props.onToggleVideo}
                                                >
                                                    <i
                                                        class="fa-solid fa-video text-[0.78rem]"
                                                        aria-hidden="true"
                                                    ></i>
                                                    <span>Có video</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        `;
    }

    function PostCard(props) {
        var post = props.post;
        var imgRef = useRef(null);
        var cover = mediaUrl(post);
        var mediaMeta = mediaSummary(post);
        var copy = getPostCopy(post);
        var title = copy.title;
        var excerpt = copy.excerpt;
        var highlightedTitleHtml = useMemo(
            function () {
                return highlightText(title, props.mark);
            },
            [title, props.mark]
        );
        var highlightedExcerptHtml = useMemo(
            function () {
                return highlightText(excerpt, props.mark);
            },
            [excerpt, props.mark]
        );

        useEffect(
            function () {
                var element = imgRef.current;
                if (!element || !cover) return;
                lazyObserver.observe(element);
                return function () {
                    lazyObserver.unobserve(element);
                };
            },
            [cover && cover.url]
        );

        return html`
            <article
                class="post-card"
                role="button"
                tabindex="0"
                style=${{ animationDelay: String((props.index % GRID_BATCH_SIZE) * 32) + 'ms' }}
                onClick=${function () {
                    props.onOpen(post.post_id);
                }}
                onKeyDown=${function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        props.onOpen(post.post_id);
                    }
                }}
            >
                <div class="card-media">
                    ${cover
                        ? html` <img
                              ref=${imgRef}
                              data-src=${cover.url}
                              data-fallback-index="0"
                              src=${PLACEHOLDER_SVG}
                              loading="lazy"
                              alt=${title}
                              onerror=${function (event) {
                                  handleImageFallback(event, cover.candidates);
                              }}
                          />`
                        : html` <div class="w-full h-full flex items-start justify-end p-5">
                              <span class="meta-pill">Text</span>
                          </div>`}

                    <div class="absolute inset-x-0 top-0 flex items-center justify-between p-4">
                        <span class="meta-pill">${formatDateShort(post.creation_time)}</span>
                        ${mediaMeta
                            ? html`<span class="meta-pill meta-pill-accent"
                                  >${mediaMeta.label}</span
                              >`
                            : ''}
                    </div>
                </div>

                <div class="p-4 flex flex-col gap-3">
                    <h3
                        class="card-title clamp-2"
                        dangerouslySetInnerHTML=${{ __html: highlightedTitleHtml }}
                    ></h3>

                    <p
                        class="card-excerpt clamp-4 m-0"
                        dangerouslySetInnerHTML=${{ __html: highlightedExcerptHtml }}
                    ></p>
                </div>
            </article>
        `;
    }

    function EmptyState(props) {
        return html`
            <div class="glass-panel rounded-[2rem] p-8 sm:p-12 text-center">
                <div class="eyebrow">No Match</div>
                <h2 class="display-font text-4xl leading-none mt-3 mb-4">
                    Không tìm thấy bài phù hợp
                </h2>
                <p class="hero-copy mx-auto">
                    Thử nới search term, bỏ date filter hoặc reset về trạng thái gốc để xem lại toàn
                    bộ archive.
                </p>
                <button
                    class="pill-button inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold mt-6"
                    onClick=${props.onReset}
                >
                    <i class="fa-solid fa-rotate-left text-[0.82rem]" aria-hidden="true"></i>
                    <span>Xóa toàn bộ filter</span>
                </button>
            </div>
        `;
    }

    function LoadingGrid() {
        return html`
            <div class="post-grid">
                ${Array.from({ length: 6 }).map(function (_, index) {
                    return html`
                        <div key=${index} class="post-card">
                            <div class="card-media skeleton"></div>
                            <div class="p-5">
                                <div class="skeleton rounded-full h-4 w-28 mb-4"></div>
                                <div class="skeleton rounded-2xl h-9 w-4/5 mb-3"></div>
                                <div class="skeleton rounded-2xl h-4 w-full mb-2"></div>
                                <div class="skeleton rounded-2xl h-4 w-5/6 mb-2"></div>
                                <div class="skeleton rounded-2xl h-4 w-3/5"></div>
                            </div>
                        </div>
                    `;
                })}
            </div>
        `;
    }

    function PostGrid(props) {
        if (props.posts.length === 0) {
            return html`<${EmptyState} onReset=${props.onReset} />`;
        }

        return html`
            <div class="post-grid">
                ${props.posts.map(function (post, index) {
                    return html` <${PostCard}
                        key=${post.post_id}
                        index=${index}
                        post=${post}
                        mark=${props.mark}
                        onOpen=${props.onOpen}
                    />`;
                })}
            </div>
        `;
    }

    function DetailTextSection(props) {
        if (!props.value) return null;
        var rendered = renderMarkdown(props.value);
        if (!rendered) return null;

        return html`
            <section class="detail-section">
                <div class="detail-kicker">${props.label}</div>
                <div class="detail-prose" dangerouslySetInnerHTML=${{ __html: rendered }}></div>
            </section>
        `;
    }

    function MediaItem(props) {
        var media = props.media;
        var ref = function (element) {
            if (!element || media.type === 'Video') return;
            props.onImageRef(element);
        };
        var isPhoto = media.type !== 'Video';

        return html`
            <figure class="detail-media">
                ${media.type === 'Video'
                    ? html` <video
                          src=${media.url}
                          controls
                          preload="metadata"
                          onerror=${function (event) {
                              event.target.style.display = 'none';
                          }}
                      ></video>`
                    : html` <img
                          ref=${ref}
                          class=${isPhoto ? 'detail-media-clickable' : ''}
                          data-src=${media.url}
                          data-fallback-index="0"
                          src=${PLACEHOLDER_SVG}
                          alt="Media"
                          loading="lazy"
                          onClick=${function () {
                              props.onOpen && props.onOpen();
                          }}
                          onerror=${function (event) {
                              handleImageFallback(event, media.candidates);
                          }}
                      />`}
            </figure>
        `;
    }

    function ImageViewer(props) {
        if (!props.open || !props.items.length) return null;

        var currentItem = props.items[props.index];
        var canNavigate = props.items.length > 1;
        var stageRef = useRef(null);
        var imageRef = useRef(null);
        var dragRef = useRef(null);
        var touchRef = useRef(null);
        var _transform = useState(getViewerTransformState());
        var transform = _transform[0];
        var setTransform = _transform[1];
        var transformRef = useRef(transform);
        var counterLabel = props.index + 1 + '/' + props.items.length;
        var metaLabel = counterLabel; // + (currentItem.id ? ' • ' + currentItem.id : '');
        var scaleLabel = Math.round(transform.scale * 100) + '%';

        useEffect(
            function () {
                transformRef.current = transform;
            },
            [transform]
        );

        useEffect(
            function () {
                dragRef.current = null;
                touchRef.current = null;
                setTransform(getViewerTransformState());
            },
            [currentItem.url]
        );

        function updateTransform(nextState) {
            var constrained = clampViewerOffset(
                nextState.scale,
                nextState.x,
                nextState.y,
                stageRef.current,
                imageRef.current
            );

            return {
                scale: nextState.scale,
                x: constrained.x,
                y: constrained.y,
                isDragging: !!nextState.isDragging
            };
        }

        function setViewerTransform(updater) {
            setTransform(function (current) {
                var nextState = typeof updater === 'function' ? updater(current) : updater;
                return updateTransform(nextState);
            });
        }

        function resetZoom() {
            dragRef.current = null;
            touchRef.current = null;
            setTransform(getViewerTransformState());
        }

        function zoomTo(nextScale, clientX, clientY) {
            setViewerTransform(function (current) {
                var scale = clamp(nextScale, IMAGE_VIEWER_MIN_SCALE, IMAGE_VIEWER_MAX_SCALE);
                if (scale <= IMAGE_VIEWER_MIN_SCALE) {
                    return getViewerTransformState();
                }

                if (!stageRef.current) {
                    return {
                        scale: scale,
                        x: current.x,
                        y: current.y,
                        isDragging: false
                    };
                }

                var rect = stageRef.current.getBoundingClientRect();
                var anchorX = clientX !== undefined ? clientX : rect.left + rect.width / 2;
                var anchorY = clientY !== undefined ? clientY : rect.top + rect.height / 2;
                var centerX = rect.left + rect.width / 2;
                var centerY = rect.top + rect.height / 2;
                var localX = (anchorX - centerX - current.x) / current.scale;
                var localY = (anchorY - centerY - current.y) / current.scale;

                return {
                    scale: scale,
                    x: anchorX - centerX - localX * scale,
                    y: anchorY - centerY - localY * scale,
                    isDragging: false
                };
            });
        }

        function adjustZoom(delta) {
            var current = transformRef.current;
            var targetScale =
                delta > 0 ? current.scale * (1 + delta) : current.scale / (1 + Math.abs(delta));
            zoomTo(targetScale);
        }

        function handleWheel(event) {
            event.preventDefault();
            var current = transformRef.current;
            var nextScale = event.deltaY < 0 ? current.scale * 1.14 : current.scale / 1.14;
            zoomTo(nextScale, event.clientX, event.clientY);
        }

        function handlePointerDown(event) {
            if (
                event.pointerType !== 'mouse' ||
                event.button !== 0 ||
                transformRef.current.scale <= 1
            )
                return;

            event.preventDefault();
            dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: transformRef.current.x,
                originY: transformRef.current.y
            };

            if (stageRef.current && stageRef.current.setPointerCapture) {
                stageRef.current.setPointerCapture(event.pointerId);
            }

            setViewerTransform(function (current) {
                return {
                    scale: current.scale,
                    x: current.x,
                    y: current.y,
                    isDragging: true
                };
            });
        }

        function handlePointerMove(event) {
            if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;

            event.preventDefault();
            var deltaX = event.clientX - dragRef.current.startX;
            var deltaY = event.clientY - dragRef.current.startY;

            setViewerTransform(function (current) {
                return {
                    scale: current.scale,
                    x: dragRef.current.originX + deltaX,
                    y: dragRef.current.originY + deltaY,
                    isDragging: true
                };
            });
        }

        function handlePointerUp(event) {
            if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;

            if (stageRef.current && stageRef.current.releasePointerCapture) {
                stageRef.current.releasePointerCapture(event.pointerId);
            }

            dragRef.current = null;
            setViewerTransform(function (current) {
                return {
                    scale: current.scale,
                    x: current.x,
                    y: current.y,
                    isDragging: false
                };
            });
        }

        function handleTouchStart(event) {
            if (event.touches.length === 2) {
                event.preventDefault();
                var firstTouch = event.touches[0];
                var secondTouch = event.touches[1];
                var midpoint = getTouchMidpoint(firstTouch, secondTouch);
                var current = transformRef.current;

                if (stageRef.current) {
                    var rect = stageRef.current.getBoundingClientRect();
                    touchRef.current = {
                        mode: 'pinch',
                        startScale: current.scale,
                        startDistance: getTouchDistance(firstTouch, secondTouch),
                        localX:
                            (midpoint.clientX - (rect.left + rect.width / 2) - current.x) /
                            current.scale,
                        localY:
                            (midpoint.clientY - (rect.top + rect.height / 2) - current.y) /
                            current.scale
                    };
                }
                return;
            }

            if (event.touches.length === 1 && transformRef.current.scale > 1) {
                event.preventDefault();
                touchRef.current = {
                    mode: 'drag',
                    startTouchX: event.touches[0].clientX,
                    startTouchY: event.touches[0].clientY,
                    startX: transformRef.current.x,
                    startY: transformRef.current.y
                };

                setViewerTransform(function (current) {
                    return {
                        scale: current.scale,
                        x: current.x,
                        y: current.y,
                        isDragging: true
                    };
                });
            }
        }

        function handleTouchMove(event) {
            if (!touchRef.current) return;

            if (
                touchRef.current.mode === 'pinch' &&
                event.touches.length === 2 &&
                stageRef.current
            ) {
                event.preventDefault();

                var firstTouch = event.touches[0];
                var secondTouch = event.touches[1];
                var midpoint = getTouchMidpoint(firstTouch, secondTouch);
                var rect = stageRef.current.getBoundingClientRect();
                var nextScale = clamp(
                    touchRef.current.startScale *
                        (getTouchDistance(firstTouch, secondTouch) /
                            touchRef.current.startDistance),
                    IMAGE_VIEWER_MIN_SCALE,
                    IMAGE_VIEWER_MAX_SCALE
                );

                setViewerTransform({
                    scale: nextScale,
                    x:
                        midpoint.clientX -
                        (rect.left + rect.width / 2) -
                        touchRef.current.localX * nextScale,
                    y:
                        midpoint.clientY -
                        (rect.top + rect.height / 2) -
                        touchRef.current.localY * nextScale,
                    isDragging: false
                });
                return;
            }

            if (touchRef.current.mode === 'drag' && event.touches.length === 1) {
                event.preventDefault();
                var deltaX = event.touches[0].clientX - touchRef.current.startTouchX;
                var deltaY = event.touches[0].clientY - touchRef.current.startTouchY;

                setViewerTransform(function (current) {
                    return {
                        scale: current.scale,
                        x: touchRef.current.startX + deltaX,
                        y: touchRef.current.startY + deltaY,
                        isDragging: true
                    };
                });
            }
        }

        function handleTouchEnd(event) {
            if (!touchRef.current) return;

            if (event.touches.length === 1 && transformRef.current.scale > 1) {
                touchRef.current = {
                    mode: 'drag',
                    startTouchX: event.touches[0].clientX,
                    startTouchY: event.touches[0].clientY,
                    startX: transformRef.current.x,
                    startY: transformRef.current.y
                };
                return;
            }

            touchRef.current = null;
            setViewerTransform(function (current) {
                return {
                    scale: current.scale,
                    x: current.x,
                    y: current.y,
                    isDragging: false
                };
            });
        }

        function handleImageDoubleClick(event) {
            event.preventDefault();
            if (transformRef.current.scale > 1) {
                resetZoom();
                return;
            }

            zoomTo(2.2, event.clientX, event.clientY);
        }

        return html`
            <div class="image-viewer" role="dialog" aria-modal="true" aria-label="Image viewer">
                <button
                    class="image-viewer-backdrop"
                    type="button"
                    aria-label="Đóng popup ảnh"
                    onClick=${props.onClose}
                ></button>

                <div class="image-viewer-shell">
                    <div class="image-viewer-topbar">
                        <div class="image-viewer-meta">
                            <span class="image-viewer-kicker">Image Viewer</span>
                            <strong>${props.title || 'Media Gallery'}</strong>
                            <span class="image-viewer-counter">${metaLabel}</span>
                        </div>

                        <div class="image-viewer-toolbar">
                            <div class="image-viewer-zoombar" aria-label="Zoom controls">
                                <button
                                    class="image-viewer-action"
                                    type="button"
                                    aria-label="Thu nhỏ ảnh"
                                    onClick=${function () {
                                        adjustZoom(-0.22);
                                    }}
                                >
                                    <i
                                        class="fa-solid fa-magnifying-glass-minus"
                                        aria-hidden="true"
                                    ></i>
                                </button>
                                <button
                                    class="image-viewer-action image-viewer-action-reset"
                                    type="button"
                                    aria-label="Reset zoom"
                                    disabled=${transform.scale <= 1.01}
                                    onClick=${resetZoom}
                                >
                                    <span>${scaleLabel}</span>
                                </button>
                                <button
                                    class="image-viewer-action"
                                    type="button"
                                    aria-label="Phóng to ảnh"
                                    onClick=${function () {
                                        adjustZoom(0.22);
                                    }}
                                >
                                    <i
                                        class="fa-solid fa-magnifying-glass-plus"
                                        aria-hidden="true"
                                    ></i>
                                </button>
                            </div>

                            <button
                                class="image-viewer-close"
                                type="button"
                                aria-label="Đóng popup ảnh"
                                onClick=${props.onClose}
                            >
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>

                    <div
                        ref=${stageRef}
                        class=${'image-viewer-stage ' +
                        (transform.scale > 1 ? 'image-viewer-stage-zoomed ' : '') +
                        (transform.isDragging ? 'image-viewer-stage-dragging' : '')}
                        onWheel=${handleWheel}
                        onPointerDown=${handlePointerDown}
                        onPointerMove=${handlePointerMove}
                        onPointerUp=${handlePointerUp}
                        onPointerCancel=${handlePointerUp}
                        onTouchStart=${handleTouchStart}
                        onTouchMove=${handleTouchMove}
                        onTouchEnd=${handleTouchEnd}
                        onTouchCancel=${handleTouchEnd}
                    >
                        ${canNavigate
                            ? html`<button
                                  class="image-viewer-nav image-viewer-nav-prev"
                                  type="button"
                                  aria-label="Ảnh trước"
                                  onClick=${function () {
                                      props.onNavigate(-1);
                                  }}
                              >
                                  <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                              </button>`
                            : ''}

                        <figure class="image-viewer-figure">
                            <img
                                ref=${imageRef}
                                key=${currentItem.type +
                                ':' +
                                currentItem.id +
                                ':' +
                                currentItem.url}
                                class=${transform.scale > 1
                                    ? 'image-viewer-image image-viewer-image-zoomed'
                                    : 'image-viewer-image'}
                                src=${currentItem.url}
                                data-fallback-index="0"
                                alt=${props.title || 'Media preview'}
                                style=${{
                                    transform:
                                        'translate(' +
                                        transform.x +
                                        'px, ' +
                                        transform.y +
                                        'px) scale(' +
                                        transform.scale +
                                        ')'
                                }}
                                onDblClick=${handleImageDoubleClick}
                                onerror=${function (event) {
                                    handleImageFallback(event, currentItem.candidates);
                                }}
                            />
                        </figure>

                        ${canNavigate
                            ? html`<button
                                  class="image-viewer-nav image-viewer-nav-next"
                                  type="button"
                                  aria-label="Ảnh tiếp theo"
                                  onClick=${function () {
                                      props.onNavigate(1);
                                  }}
                              >
                                  <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                              </button>`
                            : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function PostDetail(props) {
        var refs = useRef([]);

        useEffect(
            function () {
                if (props.loading || !props.post) return;

                refs.current.forEach(function (element) {
                    if (element && element.dataset && element.dataset.src) {
                        lazyObserver.observe(element);
                    }
                });

                return function () {
                    refs.current.forEach(function (element) {
                        if (element) lazyObserver.unobserve(element);
                    });
                };
            },
            [props.loading, props.post, props.postId]
        );

        if (props.loading) {
            return html`
                <main class="max-w-7xl mx-auto px-4 py-8">
                    <div class="detail-shell">
                        <div class="detail-main">
                            <div class="detail-banner">
                                <div class="skeleton rounded-full h-4 w-28 mb-4"></div>
                                <div class="skeleton rounded-[1.8rem] h-16 w-5/6 mb-4"></div>
                                <div class="skeleton rounded-2xl h-5 w-4/5 mb-2"></div>
                                <div class="skeleton rounded-2xl h-5 w-3/5 mb-8"></div>
                            </div>
                            <div class="detail-section">
                                <div class="skeleton rounded-[1.2rem] h-44 w-full"></div>
                            </div>
                        </div>
                        <aside class="detail-side">
                            <div class="aside-card">
                                <div class="skeleton rounded-2xl h-12 w-full"></div>
                            </div>
                        </aside>
                    </div>
                </main>
            `;
        }

        var post = props.post;
        if (!post) {
            return html`
                <main class="max-w-7xl mx-auto px-4 py-8">
                    <div class="glass-panel rounded-[2rem] p-8 text-center">
                        <div class="eyebrow">Not Found</div>
                        <h2 class="display-font text-4xl leading-none mt-3 mb-4">
                            Bài viết không tồn tại
                        </h2>
                        <p class="hero-copy mx-auto">
                            Hash hiện tại không map được về một post trong dataset.
                        </p>
                        <button
                            class="pill-button rounded-full px-5 py-3 font-semibold mt-6"
                            onClick=${props.onBack}
                        >
                            Quay lại Trang chủ
                        </button>
                    </div>
                </main>
            `;
        }

        var gallery = allMedia(post);
        var photoGallery = gallery.filter(function (item) {
            return item.type !== 'Video';
        });
        var title = getPostTitle(post);
        var summary = mediaSummary(post);

        return html`
            <main class="max-w-7xl mx-auto px-4 py-8">
                <div class="detail-shell">
                    <article class="detail-main">
                        <div class="detail-banner">
                            <div class="flex flex-wrap items-center gap-2 mb-4">
                                <span class="chip">${formatDate(post.creation_time)}</span>
                                ${summary
                                    ? html`<span class="chip"
                                          ><strong>${summary.total}</strong
                                          ><span>${summary.label}</span></span
                                      >`
                                    : ''}
                            </div>

                            <h1 class="detail-title mb-3">${title}</h1>
                        </div>

                        <${DetailTextSection}
                            label="Nội dung"
                            value=${post.content_text || post.message || ''}
                        />
                        <${DetailTextSection}
                            label="Ghi chú thêm"
                            value=${post.message && post.content_text ? post.message : ''}
                        />
                        <${DetailTextSection} label="Tóm tắt" value=${post.summary || ''} />

                        ${gallery.length
                            ? html` <section class="detail-section">
                                  <div class="detail-kicker">Media Gallery</div>
                                  <div class="detail-media-grid">
                                      ${gallery.map(function (item, index) {
                                          return html` <${MediaItem}
                                              key=${item.type + ':' + item.id}
                                              media=${item}
                                              onImageRef=${function (element) {
                                                  refs.current[index] = element;
                                              }}
                                              onOpen=${function () {
                                                  if (item.type === 'Video') return;
                                                  props.onOpenImageViewer(
                                                      photoGallery,
                                                      photoGallery.findIndex(function (entry) {
                                                          return entry.id === item.id;
                                                      })
                                                  );
                                              }}
                                          />`;
                                      })}
                                  </div>
                              </section>`
                            : ''}
                    </article>

                    <aside class="detail-side">
                        <div class="aside-card">
                            <div class="detail-kicker mb-3">Meta</div>
                            <div class="flex flex-col gap-3">
                                <div class="info-row">
                                    <span>Ngày đăng</span
                                    ><strong>${formatDateShort(post.creation_time)}</strong>
                                </div>
                                <div class="info-row">
                                    <span>Media</span
                                    ><strong>${summary ? summary.label : 'Không có'}</strong>
                                </div>
                            </div>
                        </div>

                        <div class="aside-card">
                            <div class="detail-kicker mb-3">Actions</div>
                            ${post.url
                                ? html` <a
                                      href=${post.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      class="pill-button rounded-full px-4 py-3 font-semibold inline-flex items-center justify-center w-full no-underline"
                                  >
                                      Xem trên Facebook
                                  </a>`
                                : html`<p class="m-0 text-sm text-[var(--muted)]">
                                      Không có link gốc cho bài viết này.
                                  </p>`}
                        </div>
                    </aside>
                </div>
            </main>
        `;
    }

    function App() {
        var route = parseHash();
        var storedSnapshot = readGridSnapshot();
        var initialGridParams =
            route.view === 'grid' ? route.params : normalizeGridParams(storedSnapshot || {});
        var initialGridHash = buildGridHash(initialGridParams);
        var canRestoreInitialScroll =
            route.view === 'grid' && storedSnapshot && storedSnapshot.hash === initialGridHash;
        var hasPostMap = ALL_POSTS.length ? POSTS_BY_ID[ALL_POSTS[0].post_id] : null;
        if (POSTS_LOADED && ALL_POSTS.length && !hasPostMap) {
            POSTS_BY_ID = {};
            ALL_POSTS = ALL_POSTS.map(function (post) {
                var enriched = enrichPost(post);
                POSTS_BY_ID[enriched.post_id] = enriched;
                return enriched;
            });
        }

        var _state = useState({
            view: route.view,
            postId: route.postId || null,
            q: initialGridParams.q,
            sort: initialGridParams.sort,
            dateFrom: initialGridParams.from,
            dateTo: initialGridParams.to,
            hasImage: initialGridParams.hasImage,
            hasVideo: initialGridParams.hasVideo,
            visibleCount: canRestoreInitialScroll
                ? Math.max(Number(storedSnapshot.visibleCount) || GRID_BATCH_SIZE, GRID_BATCH_SIZE)
                : GRID_BATCH_SIZE,
            pendingScrollRestore: !!canRestoreInitialScroll,
            gridLoaded: POSTS_LOADED,
            error: POSTS_ERROR,
            lastGridHash:
                storedSnapshot && storedSnapshot.hash ? storedSnapshot.hash : initialGridHash,
            themeMode: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
        });

        var state = _state[0];
        var setState = _state[1];
        var loadMoreRef = useRef(null);
        var resultsSectionRef = useRef(null);
        var snapshotParamsRef = useRef({
            q: initialGridParams.q,
            sort: initialGridParams.sort,
            from: initialGridParams.from,
            to: initialGridParams.to,
            hasImage: initialGridParams.hasImage,
            hasVideo: initialGridParams.hasVideo,
            visibleCount: canRestoreInitialScroll
                ? Math.max(Number(storedSnapshot.visibleCount) || GRID_BATCH_SIZE, GRID_BATCH_SIZE)
                : GRID_BATCH_SIZE
        });
        var snapshotWriteTimerRef = useRef(null);
        var _showScrollTop = useState(false);
        var showScrollTop = _showScrollTop[0];
        var setShowScrollTop = _showScrollTop[1];
        var showScrollTopRef = useRef(false);
        var _imageViewer = useState({
            items: [],
            index: 0,
            title: ''
        });
        var imageViewer = _imageViewer[0];
        var setImageViewer = _imageViewer[1];

        useEffect(function () {
            if (POSTS_LOADED || POSTS_ERROR) {
                setState(function (current) {
                    return Object.assign({}, current, {
                        gridLoaded: POSTS_LOADED,
                        error: POSTS_ERROR
                    });
                });
                return;
            }

            var cancelled = false;

            fetch('data/posts.min.csv')
                .then(function (response) {
                    if (!response.ok) throw new Error('Failed to load posts dataset');
                    return response.text();
                })
                .then(function (text) {
                    if (cancelled) return;
                    POSTS_BY_ID = {};
                    ALL_POSTS = parsePostsCSV(text).map(function (post) {
                        var enriched = enrichPost(post);
                        POSTS_BY_ID[enriched.post_id] = enriched;
                        return enriched;
                    });
                    POSTS_LOADED = true;
                    LATEST_POST_TS = ALL_POSTS.reduce(function (latest, post) {
                        return Math.max(latest, Number(post.creation_time || 0));
                    }, 0);

                    setState(function (current) {
                        return Object.assign({}, current, {
                            gridLoaded: true,
                            error: null
                        });
                    });
                })
                .catch(function (error) {
                    if (cancelled) return;
                    POSTS_ERROR = error && error.message ? error.message : 'Unknown error';
                    setState(function (current) {
                        return Object.assign({}, current, {
                            gridLoaded: false,
                            error: POSTS_ERROR
                        });
                    });
                });

            return function () {
                cancelled = true;
            };
        }, []);

        useEffect(function () {
            function onHashChange() {
                var nextRoute = parseHash();

                if (nextRoute.view === 'detail') {
                    setState(function (current) {
                        return Object.assign({}, current, {
                            view: 'detail',
                            postId: nextRoute.postId || null
                        });
                    });
                    return;
                }

                var snapshot = readGridSnapshot();
                var nextParams = normalizeGridParams(nextRoute.params || {});
                var nextHash = buildGridHash(nextParams);

                setState(function (current) {
                    var returningFromDetail = current.view === 'detail';
                    var shouldRestore =
                        !returningFromDetail && snapshot && snapshot.hash === nextHash;

                    return Object.assign({}, current, {
                        view: 'grid',
                        postId: null,
                        q: nextParams.q,
                        sort: nextParams.sort,
                        dateFrom: nextParams.from,
                        dateTo: nextParams.to,
                        hasImage: nextParams.hasImage,
                        hasVideo: nextParams.hasVideo,
                        visibleCount: returningFromDetail
                            ? current.visibleCount
                            : shouldRestore
                              ? Math.max(
                                    Number(snapshot.visibleCount) || GRID_BATCH_SIZE,
                                    GRID_BATCH_SIZE
                                )
                              : GRID_BATCH_SIZE,
                        pendingScrollRestore: returningFromDetail ? false : !!shouldRestore,
                        lastGridHash: nextHash
                    });
                });
            }

            window.addEventListener('hashchange', onHashChange);
            return function () {
                window.removeEventListener('hashchange', onHashChange);
            };
        }, []);

        useEffect(
            function () {
                if (state.view !== 'detail') return;
                var originalOverflow = document.body.style.overflow;
                document.body.style.overflow = 'hidden';

                return function () {
                    document.body.style.overflow = originalOverflow;
                };
            },
            [state.view]
        );

        useEffect(
            function () {
                if (state.view === 'detail') return;
                setImageViewer(function (current) {
                    if (!current.items.length) return current;
                    return {
                        items: [],
                        index: 0,
                        title: ''
                    };
                });
            },
            [state.view]
        );

        useEffect(
            function () {
                if (!imageViewer.items.length) return;

                var originalOverflow = document.body.style.overflow;

                function onKeyDown(event) {
                    if (event.key === 'Escape') {
                        setImageViewer({
                            items: [],
                            index: 0,
                            title: ''
                        });
                        return;
                    }

                    if (event.key === 'ArrowLeft') {
                        setImageViewer(function (current) {
                            if (current.items.length < 2) return current;
                            return Object.assign({}, current, {
                                index:
                                    (current.index - 1 + current.items.length) %
                                    current.items.length
                            });
                        });
                    }

                    if (event.key === 'ArrowRight') {
                        setImageViewer(function (current) {
                            if (current.items.length < 2) return current;
                            return Object.assign({}, current, {
                                index: (current.index + 1) % current.items.length
                            });
                        });
                    }
                }

                document.body.style.overflow = 'hidden';
                window.addEventListener('keydown', onKeyDown);

                return function () {
                    document.body.style.overflow = originalOverflow;
                    window.removeEventListener('keydown', onKeyDown);
                };
            },
            [imageViewer.items.length]
        );

        useEffect(
            function () {
                if (state.view !== 'grid' || !state.pendingScrollRestore || !state.gridLoaded)
                    return;

                var snapshot = readGridSnapshot();
                var targetScroll = snapshot ? Number(snapshot.scrollY || 0) : 0;
                var attempts = 5;

                function restoreScroll() {
                    window.scrollTo(0, targetScroll);
                    attempts -= 1;

                    if (attempts > 0 && Math.abs(window.scrollY - targetScroll) > 24) {
                        window.requestAnimationFrame(restoreScroll);
                        return;
                    }

                    setState(function (current) {
                        if (!current.pendingScrollRestore) return current;
                        return Object.assign({}, current, { pendingScrollRestore: false });
                    });
                }

                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(restoreScroll);
                });
            },
            [state.view, state.pendingScrollRestore, state.visibleCount, state.gridLoaded]
        );

        useEffect(
            function () {
                snapshotParamsRef.current = {
                    q: state.q,
                    sort: state.sort,
                    from: state.dateFrom,
                    to: state.dateTo,
                    hasImage: state.hasImage,
                    hasVideo: state.hasVideo,
                    visibleCount: state.visibleCount
                };

                if (state.view !== 'grid') return;

                writeGridSnapshot(
                    buildSnapshotFromGridParams(
                        snapshotParamsRef.current,
                        snapshotParamsRef.current.visibleCount,
                        window.scrollY
                    )
                );
            },
            [
                state.view,
                state.q,
                state.sort,
                state.dateFrom,
                state.dateTo,
                state.hasImage,
                state.hasVideo,
                state.visibleCount
            ]
        );

        useEffect(
            function () {
                if (state.view !== 'grid') return;

                function flushSnapshot() {
                    snapshotWriteTimerRef.current = null;
                    var params = snapshotParamsRef.current;
                    writeGridSnapshot(
                        buildSnapshotFromGridParams(params, params.visibleCount, window.scrollY)
                    );
                }

                function scheduleSnapshotWrite() {
                    if (snapshotWriteTimerRef.current !== null) return;
                    snapshotWriteTimerRef.current = window.setTimeout(
                        flushSnapshot,
                        SNAPSHOT_SCROLL_THROTTLE_MS
                    );
                }

                function flushSnapshotImmediately() {
                    if (snapshotWriteTimerRef.current !== null) {
                        window.clearTimeout(snapshotWriteTimerRef.current);
                        snapshotWriteTimerRef.current = null;
                    }
                    flushSnapshot();
                }

                function onScroll() {
                    scheduleSnapshotWrite();
                }

                function onVisibilityChange() {
                    if (document.visibilityState !== 'hidden') return;
                    flushSnapshotImmediately();
                }

                window.addEventListener('scroll', onScroll, { passive: true });
                window.addEventListener('pagehide', flushSnapshotImmediately);
                document.addEventListener('visibilitychange', onVisibilityChange);

                return function () {
                    window.removeEventListener('scroll', onScroll);
                    window.removeEventListener('pagehide', flushSnapshotImmediately);
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                    flushSnapshotImmediately();
                };
            },
            [state.view]
        );

        useEffect(
            function () {
                showScrollTopRef.current = showScrollTop;
            },
            [showScrollTop]
        );

        useEffect(
            function () {
                if (state.view !== 'grid') {
                    showScrollTopRef.current = false;
                    setShowScrollTop(false);
                    return;
                }

                function updateScrollTopVisibility() {
                    var nextVisible = window.scrollY > 960;
                    if (nextVisible === showScrollTopRef.current) return;
                    showScrollTopRef.current = nextVisible;
                    setShowScrollTop(nextVisible);
                }

                updateScrollTopVisibility();
                window.addEventListener('scroll', updateScrollTopVisibility, { passive: true });

                return function () {
                    window.removeEventListener('scroll', updateScrollTopVisibility);
                };
            },
            [state.view]
        );

        var filteredPosts = useMemo(
            function () {
                if (!state.gridLoaded) return [];
                return sortPosts(
                    filterPosts(
                        ALL_POSTS,
                        state.q,
                        state.dateFrom,
                        state.dateTo,
                        state.hasImage,
                        state.hasVideo
                    ),
                    state.sort,
                    state.q
                );
            },
            [
                state.gridLoaded,
                state.q,
                state.sort,
                state.dateFrom,
                state.dateTo,
                state.hasImage,
                state.hasVideo
            ]
        );

        var filteredCount = filteredPosts.length;
        var visiblePosts = useMemo(
            function () {
                return filteredPosts.slice(0, state.visibleCount);
            },
            [filteredPosts, state.visibleCount]
        );
        var shownCount = visiblePosts.length;
        var hasMore = shownCount < filteredCount;
        var currentPost =
            state.gridLoaded && state.postId
                ? POSTS_BY_ID[state.postId] ||
                  ALL_POSTS.find(function (post) {
                      return post.post_id === state.postId;
                  }) ||
                  null
                : null;
        useEffect(
            function () {
                if (!hasMore || state.view !== 'grid' || !loadMoreRef.current) return;

                var observer = new IntersectionObserver(
                    function (entries) {
                        if (!entries[0] || !entries[0].isIntersecting) return;

                        setState(function (current) {
                            return Object.assign({}, current, {
                                visibleCount: current.visibleCount + GRID_BATCH_SIZE
                            });
                        });
                    },
                    {
                        rootMargin: '480px 0px'
                    }
                );

                observer.observe(loadMoreRef.current);
                return function () {
                    observer.disconnect();
                };
            },
            [hasMore, state.view, state.visibleCount, filteredCount]
        );

        function applyGridState(nextParams, options) {
            var normalized = normalizeGridParams(nextParams);
            var nextHash = buildGridHash(normalized);
            var shouldPreserveScroll = options && options.preserveScroll;
            var shouldScrollToGrid = options && options.scrollToGrid;
            var nextVisibleCount =
                options && options.visibleCount !== undefined
                    ? options.visibleCount
                    : GRID_BATCH_SIZE;

            snapshotParamsRef.current = {
                q: normalized.q,
                sort: normalized.sort,
                from: normalized.from,
                to: normalized.to,
                hasImage: normalized.hasImage,
                hasVideo: normalized.hasVideo,
                visibleCount: nextVisibleCount
            };
            writeGridSnapshot(
                buildSnapshotFromGridParams(
                    snapshotParamsRef.current,
                    nextVisibleCount,
                    shouldPreserveScroll ? window.scrollY : 0
                )
            );

            setHash(nextHash, true);
            setState(function (current) {
                return Object.assign({}, current, {
                    view: 'grid',
                    postId: null,
                    q: normalized.q,
                    sort: normalized.sort,
                    dateFrom: normalized.from,
                    dateTo: normalized.to,
                    hasImage: normalized.hasImage,
                    hasVideo: normalized.hasVideo,
                    visibleCount: nextVisibleCount,
                    pendingScrollRestore: false,
                    lastGridHash: nextHash
                });
            });

            if (shouldScrollToGrid) {
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(function () {
                        var element = resultsSectionRef.current;
                        var prefersReducedMotion =
                            window.matchMedia &&
                            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

                        if (!element) {
                            window.scrollTo(0, 0);
                            return;
                        }

                        window.scrollTo({
                            top: Math.max(
                                0,
                                window.scrollY + element.getBoundingClientRect().top - 96
                            ),
                            behavior: prefersReducedMotion ? 'auto' : 'smooth'
                        });
                    });
                });
            } else if (!shouldPreserveScroll) {
                window.scrollTo(0, 0);
            }
        }

        function openPost(postId) {
            setState(function (current) {
                return Object.assign({}, current, {
                    lastGridHash: buildGridHash({
                        q: current.q,
                        sort: current.sort,
                        from: current.dateFrom,
                        to: current.dateTo,
                        hasImage: current.hasImage,
                        hasVideo: current.hasVideo
                    })
                });
            });

            setHash('#post/' + encodeURIComponent(postId), false);
        }

        function goBackToGrid() {
            var targetHash =
                state.lastGridHash ||
                buildGridHash({
                    q: state.q,
                    sort: state.sort,
                    from: state.dateFrom,
                    to: state.dateTo,
                    hasImage: state.hasImage,
                    hasVideo: state.hasVideo
                });

            setHash(targetHash, false);
        }

        function toggleTheme() {
            var darkEnabled = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', darkEnabled ? 'dark' : 'light');
            setState(function (current) {
                return Object.assign({}, current, {
                    themeMode: darkEnabled ? 'dark' : 'light'
                });
            });
        }

        function scrollToTop() {
            var prefersReducedMotion =
                window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            window.scrollTo({
                top: 0,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
        }

        function openImageViewer(items, index) {
            var photos = (items || []).filter(function (item) {
                return item.type !== 'Video';
            });
            if (!photos.length) return;

            setImageViewer({
                items: photos,
                index: index >= 0 ? index : 0,
                title: currentPost ? getPostTitle(currentPost) : 'Media Gallery'
            });
        }

        function closeImageViewer() {
            setImageViewer({
                items: [],
                index: 0,
                title: ''
            });
        }

        function moveImageViewer(step) {
            setImageViewer(function (current) {
                if (current.items.length < 2) return current;
                return Object.assign({}, current, {
                    index: (current.index + step + current.items.length) % current.items.length
                });
            });
        }

        var scrollToGridOptions = { scrollToGrid: true };

        return html`
            <div class="min-h-screen">
                <${Header}
                    totalCount=${state.gridLoaded ? ALL_POSTS.length : 0}
                    latestTs=${LATEST_POST_TS}
                    isDark=${state.themeMode === 'dark'}
                    onToggleTheme=${toggleTheme}
                    onHome=${function () {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                />

                <main class="max-w-7xl mx-auto px-4 py-6">
                    ${state.error
                        ? html` <div class="glass-panel rounded-[2rem] p-8 text-center">
                              <div class="eyebrow">Dataset Error</div>
                              <h2 class="display-font text-4xl leading-none mt-3 mb-4">
                                  Không tải được dữ liệu blog
                              </h2>
                              <p class="hero-copy mx-auto">${state.error}</p>
                              <button
                                  class="pill-button rounded-full px-5 py-3 font-semibold mt-6"
                                  onClick=${function () {
                                      window.location.reload();
                                  }}
                              >
                                  Tải lại trang
                              </button>
                          </div>`
                        : ''}
                    ${!state.error
                        ? html` <${FilterBar}
                                  q=${state.q}
                                  sort=${state.sort}
                                  dateFrom=${state.dateFrom}
                                  dateTo=${state.dateTo}
                                  hasImage=${state.hasImage}
                                  hasVideo=${state.hasVideo}
                                  totalCount=${state.gridLoaded ? ALL_POSTS.length : 0}
                                  filteredCount=${filteredCount}
                                  visibleCount=${shownCount}
                                  onSearch=${function (query) {
                                      applyGridState(
                                          {
                                              q: query,
                                              sort: query
                                                  ? state.sort
                                                  : state.sort === 'relevance'
                                                    ? 'newest'
                                                    : state.sort,
                                              from: state.dateFrom,
                                              to: state.dateTo,
                                              hasImage: state.hasImage,
                                              hasVideo: state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onSort=${function (sortValue) {
                                      applyGridState(
                                          {
                                              q: state.q,
                                              sort:
                                                  sortValue === 'relevance' && !state.q
                                                      ? 'newest'
                                                      : sortValue,
                                              from: state.dateFrom,
                                              to: state.dateTo,
                                              hasImage: state.hasImage,
                                              hasVideo: state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onDateFrom=${function (value) {
                                      applyGridState(
                                          {
                                              q: state.q,
                                              sort: state.sort,
                                              from: value,
                                              to: state.dateTo,
                                              hasImage: state.hasImage,
                                              hasVideo: state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onDateTo=${function (value) {
                                      applyGridState(
                                          {
                                              q: state.q,
                                              sort: state.sort,
                                              from: state.dateFrom,
                                              to: value,
                                              hasImage: state.hasImage,
                                              hasVideo: state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onToggleImage=${function () {
                                      applyGridState(
                                          {
                                              q: state.q,
                                              sort: state.sort,
                                              from: state.dateFrom,
                                              to: state.dateTo,
                                              hasImage: !state.hasImage,
                                              hasVideo: state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onToggleVideo=${function () {
                                      applyGridState(
                                          {
                                              q: state.q,
                                              sort: state.sort,
                                              from: state.dateFrom,
                                              to: state.dateTo,
                                              hasImage: state.hasImage,
                                              hasVideo: !state.hasVideo
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                                  onClear=${function () {
                                      applyGridState(
                                          {
                                              q: '',
                                              sort: 'newest',
                                              from: '',
                                              to: '',
                                              hasImage: false,
                                              hasVideo: false
                                          },
                                          scrollToGridOptions
                                      );
                                  }}
                              />

                              <section ref=${resultsSectionRef} class="mt-5 sm:mt-6">
                                  ${state.gridLoaded
                                      ? html` <${PostGrid}
                                            posts=${visiblePosts}
                                            mark=${state.q}
                                            onOpen=${openPost}
                                            onReset=${function () {
                                                applyGridState(
                                                    {
                                                        q: '',
                                                        sort: 'newest',
                                                        from: '',
                                                        to: '',
                                                        hasImage: false,
                                                        hasVideo: false
                                                    },
                                                    scrollToGridOptions
                                                );
                                            }}
                                        />`
                                      : html`<${LoadingGrid} />`}
                                  ${state.gridLoaded && hasMore
                                      ? html` <div
                                            class="mt-6 sm:mt-8 flex flex-col items-center gap-3"
                                        >
                                            <div ref=${loadMoreRef} aria-hidden="true"></div>
                                            <button
                                                class="pill-button rounded-full px-5 py-3 font-semibold"
                                                onClick=${function () {
                                                    setState(function (current) {
                                                        return Object.assign({}, current, {
                                                            visibleCount:
                                                                current.visibleCount +
                                                                GRID_BATCH_SIZE
                                                        });
                                                    });
                                                }}
                                            >
                                                Tải thêm
                                                ${Math.min(
                                                    GRID_BATCH_SIZE,
                                                    filteredCount - shownCount
                                                )}
                                                bài
                                            </button>
                                        </div>`
                                      : ''}
                              </section>`
                        : ''}
                </main>

                ${state.view === 'grid' && showScrollTop
                    ? html`<button
                          class="scroll-top-button"
                          type="button"
                          aria-label="Cuộn lên đầu trang"
                          onClick=${scrollToTop}
                      >
                          <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
                          <span>Top</span>
                      </button>`
                    : ''}

                ${state.view === 'detail'
                    ? html` <div class="detail-overlay" role="dialog" aria-modal="true">
                          <div class="detail-overlay-inner">
                              <${DetailTopbar}
                                  isDark=${state.themeMode === 'dark'}
                                  onBack=${goBackToGrid}
                                  onHome=${goBackToGrid}
                                  onToggleTheme=${toggleTheme}
                              />
                              <${PostDetail}
                                  loading=${!state.gridLoaded && !state.error}
                                  post=${currentPost}
                                  postId=${state.postId}
                                  onBack=${goBackToGrid}
                                  onOpenImageViewer=${openImageViewer}
                              />
                          </div>
                      </div>`
                    : ''}

                <${ImageViewer}
                    open=${!!imageViewer.items.length}
                    items=${imageViewer.items}
                    index=${imageViewer.index}
                    title=${imageViewer.title}
                    onClose=${closeImageViewer}
                    onNavigate=${moveImageViewer}
                />
            </div>
        `;
    }

    render(html`<${App} />`, document.getElementById('root'));
})();
