import { html } from '../runtime.js';

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

export default DetailTopbar;
