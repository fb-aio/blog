import { useEffect, useMemo, useRef, useState } from '../runtime.js';
import { GRID_BATCH_SIZE, SNAPSHOT_SCROLL_THROTTLE_MS } from '../config/constants.js';
import { enrichPost, filterPosts, getPostTitle, parsePostsCSV, sortPosts } from '../data/posts.js';
import { buildGridHash, normalizeGridParams, parseHash, setHash } from '../utils/routing.js';
import { buildSnapshotFromGridParams, readGridSnapshot, writeGridSnapshot } from '../utils/snapshot.js';
import DetailTopbar from '../components/DetailTopbar.js';
import FilterBar from '../components/FilterBar.js';
import Header from '../components/Header.js';
import ImageViewer from '../components/ImageViewer.js';
import ContactScreen from '../components/ContactScreen.js';
import PostDetail from '../components/PostDetail.js';
import PostGrid, { LoadingGrid } from '../components/PostGrid.js';
import { html } from '../runtime.js';

let ALL_POSTS = [];
let POSTS_BY_ID = {};
let POSTS_LOADED = false;
let POSTS_ERROR = null;
let LATEST_POST_TS = 0;

if (window.marked && window.marked.setOptions) {
    window.marked.setOptions({
        gfm: true,
        breaks: true
    });
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

                if (nextRoute.view === 'contact') {
                    setState(function (current) {
                        return Object.assign({}, current, {
                            view: 'contact',
                            postId: null
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
                if (state.view !== 'detail' && state.view !== 'contact') return;
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

        function openContact() {
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

            setHash('#contact', false);
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
                    onContact=${openContact}
                    onHome=${function () {
                        if (state.view !== 'grid') {
                            goBackToGrid();
                            return;
                        }
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

                ${state.view === 'contact'
                    ? html` <div class="detail-overlay" role="dialog" aria-modal="true">
                          <div class="detail-overlay-inner">
                              <${DetailTopbar}
                                  isDark=${state.themeMode === 'dark'}
                                  onBack=${goBackToGrid}
                                  onHome=${goBackToGrid}
                                  onToggleTheme=${toggleTheme}
                              />
                              <${ContactScreen} />
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

export default App;
