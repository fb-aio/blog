import { html, useEffect, useRef } from '../runtime.js';
import { PLACEHOLDER_SVG } from '../config/constants.js';
import {
    allMedia,
    getPostTitle,
    handleImageFallback,
    mediaSummary,
    renderMarkdown
} from '../data/posts.js';
import { formatDate, formatDateShort } from '../utils/dates.js';
import lazyObserver from '../utils/lazyObserver.js';

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

export default PostDetail;
