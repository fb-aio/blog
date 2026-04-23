import { html, useEffect, useRef, useState } from '../runtime.js';
import { PLACEHOLDER_SVG } from '../config/constants.js';
import {
    allMedia,
    getPostPermalink,
    getPostTitle,
    handleImageFallback,
    mediaSummary,
    renderMarkdown
} from '../data/posts.js';
import { formatDate, formatDateShort } from '../utils/dates.js';
import { escapeHtml, formatNumber } from '../utils/text.js';
import lazyObserver from '../utils/lazyObserver.js';

var DETAIL_CACHE = Object.create(null);
var POST_NOTE_MAP = null;
var POST_NOTE_LOAD_ERROR = '';
var REACTION_EMOJI_BY_ID = {
    1635855486666999: '👍',
    1678524932434102: '💖',
    613557422527858: '❤️',
    115940658764963: '😂',
    478547315650144: '😮',
    908563459236466: '😢',
    444813342392137: '😡',
    869508936487422: '🤳',
    1663186627268800: '🧙',
    899779720071651: '🐶',
    938644726258608: '🔥',
    1609920819308489: '✈️',
    1667835766830853: '🎉',
    1536130110011063: '😕'
};

function unwrapDetailPayload(payload) {
    if (payload && payload.result && typeof payload.result === 'object') return payload.result;
    return payload && typeof payload === 'object' ? payload : null;
}

function normalizePostNotesPayload(payload) {
    var source =
        payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : payload;

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return Object.create(null);
    }

    return Object.keys(source).reduce(function (result, postId) {
        var entry = source[postId];
        if (typeof entry === 'string' && entry.trim()) {
            result[postId] = entry.trim();
            return result;
        }

        if (
            entry &&
            typeof entry === 'object' &&
            typeof entry.note === 'string' &&
            entry.note.trim()
        ) {
            result[postId] = entry.note.trim();
        }

        return result;
    }, Object.create(null));
}

function toCount(value) {
    var parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getNestedCount(post, key) {
    var value = post ? post[key] : 0;
    if (value && typeof value === 'object') {
        if (value.total !== undefined) return toCount(value.total);
        if (value.total_count !== undefined) return toCount(value.total_count);
    }
    return toCount(value);
}

function getDetailMetrics(post, detail) {
    var detailComments = detail && detail.comments ? detail.comments : null;
    var detailReactions = detail && detail.reactions ? detail.reactions : null;

    return {
        comments: detailComments
            ? toCount(
                  detailComments.total_count !== undefined
                      ? detailComments.total_count
                      : detailComments.total
              )
            : getNestedCount(post, 'comments'),
        reactions: detailReactions
            ? toCount(detailReactions.total)
            : getNestedCount(post, 'reactions'),
        shares:
            detail && detail.shares !== undefined
                ? toCount(detail.shares)
                : getNestedCount(post, 'shares')
    };
}

function normalizeComparableText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function DetailPill(props) {
    return html`
        <span class="chip">
            <span>
                ${props.iconClass
                    ? html`<i class=${props.iconClass} aria-hidden="true"></i>`
                    : props.label}
            </span>
            <strong>${props.value}</strong>
        </span>
    `;
}

function DetailTagList(props) {
    if (!props.items || !props.items.length) return null;

    return html`
        <section class="detail-section">
            <div class="detail-kicker">${props.label}</div>
            <div class="flex flex-wrap gap-2">
                ${props.items.map(function (item) {
                    return html`<span class="chip"><strong>${item}</strong></span>`;
                })}
            </div>
        </section>
    `;
}

function DetailReactionList(props) {
    if (!props.items || !props.items.length) return null;

    return html`
        <section class="detail-section">
            <div class="detail-kicker">Top Reactions</div>
            <div class="flex flex-wrap gap-2">
                ${props.items.map(function (item) {
                    var emoji = REACTION_EMOJI_BY_ID[item.id] || null;
                    return html`
                        <span class="chip">
                            <span>${emoji || item.name || 'Reaction'}</span>
                            <strong>${formatNumber(item.count)}</strong>
                        </span>
                    `;
                })}
            </div>
        </section>
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

function isNonEmptyObject(value) {
    return (
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
    );
}

function clampRange(range, textLength) {
    if (!range) return null;
    var start = Math.max(0, Number(range.offset) || 0);
    var length = Math.max(0, Number(range.length) || 0);
    var end = Math.min(textLength, start + length);
    if (end <= start) return null;

    return {
        start: start,
        end: end
    };
}

function getEntityHref(range) {
    var entity = range && range.entity ? range.entity : null;
    var candidates = [
        entity && entity.web_link ? entity.web_link.url : '',
        entity ? entity.external_url : '',
        entity ? entity.url : '',
        entity ? entity.mobileUrl : ''
    ];

    for (var index = 0; index < candidates.length; index += 1) {
        var value = String(candidates[index] || '').trim();
        if (/^https?:\/\//i.test(value)) return value;
    }

    return '';
}

function wrapRichInlineStyles(text, styles) {
    if (!styles || !styles.length) return text;

    var ordered = ['CODE', 'BOLD', 'ITALIC', 'UNDERLINE'];
    return ordered.reduce(function (output, styleName) {
        if (styles.indexOf(styleName) === -1) return output;
        if (styleName === 'CODE') return '<code>' + output + '</code>';
        if (styleName === 'BOLD') return '<strong>' + output + '</strong>';
        if (styleName === 'ITALIC') return '<em>' + output + '</em>';
        if (styleName === 'UNDERLINE') return '<u>' + output + '</u>';
        return output;
    }, text);
}

function renderRichBlockText(block) {
    var text = String((block && block.text) || '');
    if (!text) return '<br>';

    var styleRanges = Array.isArray(block.inline_style_ranges) ? block.inline_style_ranges : [];
    var entityRanges = Array.isArray(block.entity_ranges) ? block.entity_ranges : [];
    var boundaries = [0, text.length];

    styleRanges.forEach(function (range) {
        var normalized = clampRange(range, text.length);
        if (!normalized) return;
        boundaries.push(normalized.start, normalized.end);
    });

    entityRanges.forEach(function (range) {
        var normalized = clampRange(range, text.length);
        if (!normalized) return;
        boundaries.push(normalized.start, normalized.end);
    });

    boundaries = Array.from(new Set(boundaries)).sort(function (left, right) {
        return left - right;
    });

    var output = '';

    for (var index = 0; index < boundaries.length - 1; index += 1) {
        var start = boundaries[index];
        var end = boundaries[index + 1];
        if (end <= start) continue;

        var segmentText = escapeHtml(text.slice(start, end)).replace(/\n/g, '<br>');
        var activeStyles = styleRanges
            .filter(function (range) {
                var normalized = clampRange(range, text.length);
                return normalized && normalized.start <= start && normalized.end >= end;
            })
            .map(function (range) {
                return range.inline_style;
            })
            .filter(Boolean);
        var activeEntity = entityRanges.find(function (range) {
            var normalized = clampRange(range, text.length);
            return normalized && normalized.start <= start && normalized.end >= end;
        });
        var segmentMarkup = wrapRichInlineStyles(segmentText, activeStyles);
        var href = getEntityHref(activeEntity);

        if (href) {
            segmentMarkup =
                '<a href="' +
                escapeHtml(href) +
                '" target="_blank" rel="noreferrer noopener">' +
                segmentMarkup +
                '</a>';
        }

        output += segmentMarkup;
    }

    return output || '<br>';
}

function renderRichMessageHtml(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return '';

    var output = '';
    var currentListType = '';
    var currentListItems = [];

    function flushList() {
        if (!currentListType || !currentListItems.length) return;
        output +=
            '<' +
            currentListType +
            '>' +
            currentListItems
                .map(function (item) {
                    return '<li>' + item + '</li>';
                })
                .join('') +
            '</' +
            currentListType +
            '>';
        currentListType = '';
        currentListItems = [];
    }

    blocks.forEach(function (block) {
        var type = block && block.block_type ? block.block_type : 'UNSTYLED';
        var blockText = renderRichBlockText(block);

        if (type === 'UNORDERED_LIST_ITEM' || type === 'ORDERED_LIST_ITEM') {
            var nextListType = type === 'ORDERED_LIST_ITEM' ? 'ol' : 'ul';
            if (currentListType && currentListType !== nextListType) {
                flushList();
            }
            currentListType = nextListType;
            currentListItems.push(blockText);
            return;
        }

        flushList();

        if (type === 'HEADER_ONE') {
            output += '<h2>' + blockText + '</h2>';
            return;
        }

        if (type === 'HEADER_TWO') {
            output += '<h3>' + blockText + '</h3>';
            return;
        }

        if (type === 'BLOCKQUOTE') {
            output += '<blockquote>' + blockText + '</blockquote>';
            return;
        }

        output += '<p>' + blockText + '</p>';
    });

    flushList();
    return output;
}

function normalizeArgbColor(value) {
    var normalized = String(value || '')
        .trim()
        .replace(/^#/, '');
    if (!/^[0-9a-fA-F]{8}$/.test(normalized)) return '';

    var alpha = parseInt(normalized.slice(0, 2), 16) / 255;
    var red = parseInt(normalized.slice(2, 4), 16);
    var green = parseInt(normalized.slice(4, 6), 16);
    var blue = parseInt(normalized.slice(6, 8), 16);

    return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha.toFixed(3) + ')';
}

function getGradientDirection(value) {
    if (value === 'BL_TR') return 'to top right';
    if (value === 'TL_BR') return 'to bottom right';
    return 'to bottom';
}

function buildTextFormatStyle(textFormat) {
    var backgroundColor = normalizeArgbColor(textFormat.background_color);
    var gradientColor = normalizeArgbColor(textFormat.background_gradient_color);
    var textColor = normalizeArgbColor(textFormat.color);
    var styles = [];

    if (gradientColor && backgroundColor) {
        styles.push(
            'background: linear-gradient(' +
                getGradientDirection(textFormat.background_gradient_direction) +
                ', ' +
                gradientColor +
                ', ' +
                backgroundColor +
                ')'
        );
    } else if (backgroundColor) {
        styles.push('background: ' + backgroundColor);
    }

    if (textColor) styles.push('color: ' + textColor);
    if (textFormat.text_align)
        styles.push('text-align: ' + String(textFormat.text_align).toLowerCase());
    if (textFormat.font_weight)
        styles.push('font-weight: ' + String(textFormat.font_weight).toLowerCase());
    if (textFormat.font_style)
        styles.push('font-style: ' + String(textFormat.font_style).toLowerCase());

    return styles.join('; ');
}

function DetailContentSection(props) {
    var richMessage = Array.isArray(props.richMessage) ? props.richMessage.filter(Boolean) : [];
    var textFormat = isNonEmptyObject(props.textFormat) ? props.textFormat : null;
    var richHtml = richMessage.length ? renderRichMessageHtml(richMessage) : '';

    if (richHtml) {
        return html`
            <section class="detail-section">
                <div class="detail-kicker">${props.label}</div>
                <div class="detail-prose" dangerouslySetInnerHTML=${{ __html: richHtml }}></div>
            </section>
        `;
    }

    if (textFormat && props.value) {
        return html`
            <section class="detail-section">
                <div class="detail-kicker">${props.label}</div>
                <div
                    class="detail-prose detail-formatted-message"
                    style=${buildTextFormatStyle(textFormat)}
                    dangerouslySetInnerHTML=${{
                        __html: escapeHtml(props.value).replace(/\n/g, '<br>')
                    }}
                ></div>
            </section>
        `;
    }

    return html`<${DetailTextSection} label=${props.label} value=${props.value} />`;
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
        if (event.pointerType !== 'mouse' || event.button !== 0 || transformRef.current.scale <= 1)
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

        if (touchRef.current.mode === 'pinch' && event.touches.length === 2 && stageRef.current) {
            event.preventDefault();

            var firstTouch = event.touches[0];
            var secondTouch = event.touches[1];
            var midpoint = getTouchMidpoint(firstTouch, secondTouch);
            var rect = stageRef.current.getBoundingClientRect();
            var nextScale = clamp(
                touchRef.current.startScale *
                    (getTouchDistance(firstTouch, secondTouch) / touchRef.current.startDistance),
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
                                <i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
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
                            key=${currentItem.type + ':' + currentItem.id + ':' + currentItem.url}
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
    var _detailState = useState({
        status: props.postId ? 'idle' : 'missing',
        data: null,
        error: ''
    });
    var detailState = _detailState[0];
    var setDetailState = _detailState[1];
    var _noteState = useState({
        status: POST_NOTE_MAP ? 'success' : 'idle',
        data: POST_NOTE_MAP || Object.create(null),
        error: POST_NOTE_LOAD_ERROR
    });
    var noteState = _noteState[0];
    var setNoteState = _noteState[1];

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

    useEffect(
        function () {
            if (!props.postId) {
                setDetailState({ status: 'missing', data: null, error: '' });
                return;
            }

            if (DETAIL_CACHE[props.postId]) {
                setDetailState(DETAIL_CACHE[props.postId]);
                return;
            }

            var cancelled = false;
            setDetailState({ status: 'loading', data: null, error: '' });

            fetch('data/details/' + encodeURIComponent(props.postId) + '.json')
                .then(function (response) {
                    if (response.status === 404) return null;
                    if (!response.ok) {
                        throw new Error('Không tải được detail data cho bài viết này.');
                    }
                    return response.json();
                })
                .then(function (payload) {
                    if (cancelled) return;
                    var nextState = payload
                        ? { status: 'success', data: unwrapDetailPayload(payload), error: '' }
                        : { status: 'missing', data: null, error: '' };
                    DETAIL_CACHE[props.postId] = nextState;
                    setDetailState(nextState);
                })
                .catch(function (error) {
                    if (cancelled) return;
                    var nextState = {
                        status: 'error',
                        data: null,
                        error:
                            error && error.message
                                ? error.message
                                : 'Không tải được detail data cho bài viết này.'
                    };
                    DETAIL_CACHE[props.postId] = nextState;
                    setDetailState(nextState);
                });

            return function () {
                cancelled = true;
            };
        },
        [props.postId]
    );

    useEffect(function () {
        if (POST_NOTE_MAP) {
            setNoteState({
                status: 'success',
                data: POST_NOTE_MAP,
                error: POST_NOTE_LOAD_ERROR
            });
            return;
        }

        var cancelled = false;
        setNoteState(function (current) {
            if (current.status === 'success') return current;
            return {
                status: 'loading',
                data: current.data || Object.create(null),
                error: ''
            };
        });

        fetch('data/post-notes.json')
            .then(function (response) {
                if (response.status === 404) return Object.create(null);
                if (!response.ok) throw new Error('Không tải được post notes.');
                return response.json();
            })
            .then(function (payload) {
                if (cancelled) return;
                POST_NOTE_MAP = normalizePostNotesPayload(payload);
                POST_NOTE_LOAD_ERROR = '';
                setNoteState({
                    status: 'success',
                    data: POST_NOTE_MAP,
                    error: ''
                });
            })
            .catch(function (error) {
                if (cancelled) return;
                POST_NOTE_MAP = Object.create(null);
                POST_NOTE_LOAD_ERROR =
                    error && error.message ? error.message : 'Không tải được post notes.';
                setNoteState({
                    status: 'error',
                    data: POST_NOTE_MAP,
                    error: POST_NOTE_LOAD_ERROR
                });
            });

        return function () {
            cancelled = true;
        };
    }, []);

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
    var postUrl = getPostPermalink(post);
    var summary = mediaSummary(post);
    var detail = detailState.data;
    var metrics = getDetailMetrics(post, detail);
    var hashtags = detail && Array.isArray(detail.hashtags) ? detail.hashtags.filter(Boolean) : [];
    var mentions =
        detail && Array.isArray(detail.mentions)
            ? detail.mentions
                  .map(function (mention) {
                      return mention && mention.text ? mention.text : mention && mention.name;
                  })
                  .filter(Boolean)
            : [];
    var topReactions =
        detail && detail.reactions && Array.isArray(detail.reactions.top)
            ? detail.reactions.top
            : [];
    var richMessageBlocks =
        detail && Array.isArray(detail.rich_message) ? detail.rich_message.filter(Boolean) : [];
    var textFormat = detail && isNonEmptyObject(detail.text_format) ? detail.text_format : null;
    var primaryContent = post.content_text || post.message || '';
    var renderedContentValue = detail && detail.text ? detail.text : primaryContent;
    var additionalNote =
        post.message &&
        post.content_text &&
        normalizeComparableText(post.message) !== normalizeComparableText(primaryContent)
            ? post.message
            : '';
    var attachedPostText =
        detail && detail.attached_post && detail.attached_post.text
            ? detail.attached_post.text
            : '';
    var shouldShowAttachedPostText =
        !!attachedPostText &&
        normalizeComparableText(attachedPostText) !== normalizeComparableText(primaryContent);
    var actorName =
        detail && Array.isArray(detail.actors) && detail.actors[0] ? detail.actors[0].name : '';
    var actorUrl =
        detail && Array.isArray(detail.actors) && detail.actors[0] && detail.actors[0].url
            ? detail.actors[0].url
            : '';
    var postedTo = detail && detail.posted_to ? detail.posted_to : null;
    var privacyScope = detail && detail.privacy_scope ? detail.privacy_scope : '';
    var detailLoaded = detailState.status === 'success';
    var postNote =
        noteState && noteState.data && post && post.post_id
            ? noteState.data[post.post_id] || ''
            : '';

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
                            <${DetailPill}
                                label="Reactions"
                                iconClass="fa-solid fa-heart"
                                value=${formatNumber(metrics.reactions)}
                            />
                            <${DetailPill}
                                label="Comments"
                                iconClass="fa-regular fa-comment"
                                value=${formatNumber(metrics.comments)}
                            />
                            <${DetailPill}
                                label="Shares"
                                iconClass="fa-solid fa-share-nodes"
                                value=${formatNumber(metrics.shares)}
                            />
                        </div>

                        <h1 class="detail-title mb-3">${title}</h1>
                        ${detailState.status === 'loading'
                            ? html`<p class="m-0 text-sm text-[var(--muted)]">
                                  Đang tải thêm chi tiết bài viết...
                              </p>`
                            : ''}
                        ${detailState.status === 'error'
                            ? html`<p class="m-0 text-sm text-[var(--muted)]">
                                  ${detailState.error}
                              </p>`
                            : ''}
                    </div>

                    <${DetailContentSection}
                        label="Nội dung"
                        value=${renderedContentValue}
                        richMessage=${richMessageBlocks}
                        textFormat=${textFormat}
                    />
                    <${DetailTextSection} label="Ghi chú thêm" value=${additionalNote} />
                    <${DetailTextSection} label="Tóm tắt" value=${post.summary || ''} />
                    <${DetailTextSection}
                        label="Nội dung bài gốc"
                        value=${shouldShowAttachedPostText ? attachedPostText : ''}
                    />
                    <${DetailTextSection} label="Notes" value=${postNote} />
                    <${DetailTagList} label="Hashtags" items=${hashtags} />
                    <${DetailTagList} label="Mentions" items=${mentions} />
                    <${DetailReactionList} items=${topReactions} />

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
                                <span>
                                    <i class="fa-regular fa-clock" aria-hidden="true"></i> Ngày
                                    đăng</span
                                ><strong>${formatDateShort(post.creation_time)}</strong>
                            </div>
                            <div class="info-row">
                                <span
                                    ><i class="fa-regular fa-images" aria-hidden="true"></i>
                                    Media</span
                                ><strong>${summary ? summary.label : 'Không có'}</strong>
                            </div>
                            <div class="info-row">
                                <span
                                    ><i class="fa-solid fa-heart" aria-hidden="true"></i>
                                    Reactions</span
                                ><strong>${formatNumber(metrics.reactions)}</strong>
                            </div>
                            <div class="info-row">
                                <span
                                    ><i class="fa-regular fa-comment" aria-hidden="true"></i>
                                    Comments</span
                                ><strong>${formatNumber(metrics.comments)}</strong>
                            </div>
                            <div class="info-row">
                                <span
                                    ><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
                                    Shares</span
                                ><strong>${formatNumber(metrics.shares)}</strong>
                            </div>
                            ${actorName
                                ? html`<div class="info-row">
                                      <span
                                          ><i class="fa-regular fa-user" aria-hidden="true"></i> Tác
                                          giả</span
                                      >
                                      <strong>
                                          ${actorUrl
                                              ? html`<a
                                                    href=${actorUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="text-inherit underline"
                                                >
                                                    ${actorName}
                                                </a>`
                                              : actorName}
                                      </strong>
                                  </div>`
                                : ''}
                            ${postedTo && postedTo.name
                                ? html`<div class="info-row">
                                      <span
                                          ><i
                                              class="fa-solid fa-location-dot"
                                              aria-hidden="true"
                                          ></i>
                                          Đăng tại</span
                                      >
                                      <strong>
                                          ${postedTo.url
                                              ? html`<a
                                                    href=${postedTo.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="text-inherit underline"
                                                >
                                                    ${postedTo.name}
                                                </a>`
                                              : postedTo.name}
                                      </strong>
                                  </div>`
                                : ''}
                            ${privacyScope
                                ? html`<div class="info-row">
                                      <span
                                          ><i class="fa-solid fa-lock" aria-hidden="true"></i> Quyền
                                          riêng tư</span
                                      ><strong>${privacyScope}</strong>
                                  </div>`
                                : ''}
                            ${detailLoaded
                                ? html`<div class="info-row">
                                      <span
                                          ><i
                                              class="fa-solid fa-box-archive"
                                              aria-hidden="true"
                                          ></i>
                                          Detail data</span
                                      ><strong>Có</strong>
                                  </div>`
                                : ''}
                        </div>
                    </div>

                    <div class="aside-card">
                        <div class="detail-kicker mb-3">Actions</div>
                        ${postUrl
                            ? html` <a
                                  href=${postUrl}
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

export default PostDetail;
