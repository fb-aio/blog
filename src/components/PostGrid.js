import { html, useEffect, useMemo, useRef } from '../runtime.js';
import { GRID_BATCH_SIZE, PLACEHOLDER_SVG } from '../config/constants.js';
import { getPostCopy, handleImageFallback, mediaSummary, mediaUrl } from '../data/posts.js';
import { formatDateShort } from '../utils/dates.js';
import { highlightText } from '../utils/text.js';
import lazyObserver from '../utils/lazyObserver.js';

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

export function LoadingGrid() {
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

export default PostGrid;
