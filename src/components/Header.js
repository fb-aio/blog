import { html } from '../runtime.js';
import { formatNumber } from '../utils/text.js';
import { formatDateShort } from '../utils/dates.js';

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

                        <div class="hero-actions">
                            <a
                                class="pill-button hero-link-button inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold no-underline"
                                href="https://fbaio.org"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i>
                                <span>Extension</span>
                            </a>

                            <button
                                class="pill-button hero-link-button inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold"
                                type="button"
                                onClick=${props.onContact}
                            >
                                <i class="fa-solid fa-headset" aria-hidden="true"></i>
                                <span>Liên hệ</span>
                            </button>
                        </div>
                    </div>

                    <div
                        class="glass-panel panel-strong rounded-[1.4rem] p-3 sm:p-4"
                        style="box-shadow: var(--hero-shadow);"
                    >
                        <div class="grid grid-cols-2 gap-3">
                            <div class="stat-card">
                                <span class="stat-label">Tổng bài viết</span>
                                <strong class="stat-value">${formatNumber(props.totalCount)}</strong>
                            </div>
                            <div class="stat-card">
                                <span class="stat-label">Bài mới nhất</span>
                                <strong class="stat-value"
                                    >${props.latestTs ? formatDateShort(props.latestTs) : '...'}</strong
                                >
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    `;
}

export default Header;
