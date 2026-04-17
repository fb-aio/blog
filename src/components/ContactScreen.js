import { html } from '../runtime.js';
import { SUPPORT_SECTIONS } from '../data/supportLinks.js';

function ContactScreen() {
    return html`
        <main class="max-w-7xl mx-auto px-4 py-8">
            <section class="contact-hero glass-panel panel-strong rounded-[2rem] p-6 sm:p-8">
                <div class="eyebrow">Support</div>
                <div class="contact-hero-grid">
                    <div>
                        <h1 class="display-font text-[clamp(2rem,4vw,3.25rem)] leading-[0.95] mt-3 mb-3">
                            Liên hệ FB AIO
                        </h1>
                        <p class="hero-copy m-0">
                            Nếu bạn cần hỗ trợ, muốn vào cộng đồng, hoặc muốn báo lỗi và đề xuất
                            tính năng, chọn đúng kênh bên dưới. Tất cả dữ liệu ở màn hình này được
                            lấy từ cấu hình Support của app chính.
                        </p>
                    </div>
                    <div class="contact-hero-note">
                        <span class="chip chip-muted">Cộng đồng</span>
                        <span class="chip chip-muted">Admin</span>
                        <span class="chip chip-muted">Feedback</span>
                    </div>
                </div>
            </section>

            <section class="contact-sections mt-6 sm:mt-8">
                ${SUPPORT_SECTIONS.map(function (section) {
                    return html`
                        <article class="glass-panel contact-section-card rounded-[1.6rem] p-5 sm:p-6">
                            <div class="detail-kicker mb-4">${section.title}</div>
                            <div class="contact-link-list">
                                ${section.items.map(function (item) {
                                    return html`
                                        <a
                                            class="contact-link-card"
                                            href=${item.href}
                                            target=${item.target || '_self'}
                                            rel=${item.target === '_blank' ? 'noopener noreferrer' : null}
                                        >
                                            <span class="contact-link-icon" aria-hidden="true">
                                                <i class=${item.iconClass}></i>
                                            </span>
                                            <span class="contact-link-copy">
                                                <strong>${item.label}</strong>
                                                <span>${item.meta}</span>
                                            </span>
                                            <span class="contact-link-arrow" aria-hidden="true">
                                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                            </span>
                                        </a>
                                    `;
                                })}
                            </div>
                        </article>
                    `;
                })}
            </section>
        </main>
    `;
}

export default ContactScreen;
