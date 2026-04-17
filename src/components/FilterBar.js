import { html, useEffect, useState } from '../runtime.js';
import { formatNumber } from '../utils/text.js';

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

export default FilterBar;
