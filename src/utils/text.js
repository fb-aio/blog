export function formatNumber(value) {
    return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

export function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function normalizeSearchText(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

export function buildSearchIndex(text) {
    const source = String(text || '');
    let normalized = '';
    const indexMap = [];

    for (let i = 0; i < source.length; i += 1) {
        const folded = source[i]
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase();

        for (let j = 0; j < folded.length; j += 1) {
            normalized += folded[j];
            indexMap.push(i);
        }
    }

    return { source, normalized, indexMap };
}

export function highlightText(text, term) {
    const source = String(text || '');
    if (!term) return escapeHtml(source);

    const normalizedTerm = normalizeSearchText(term).trim();
    if (!normalizedTerm) return escapeHtml(source);

    const searchIndex = buildSearchIndex(source);
    const ranges = [];
    let cursor = 0;

    while (cursor < searchIndex.normalized.length) {
        const start = searchIndex.normalized.indexOf(normalizedTerm, cursor);
        if (start === -1) break;

        const end = start + normalizedTerm.length - 1;
        const originalStart = searchIndex.indexMap[start];
        const originalEnd = searchIndex.indexMap[end] + 1;
        const previous = ranges[ranges.length - 1];

        if (previous && originalStart <= previous[1]) {
            previous[1] = Math.max(previous[1], originalEnd);
        } else {
            ranges.push([originalStart, originalEnd]);
        }

        cursor = start + normalizedTerm.length;
    }

    if (!ranges.length) return escapeHtml(source);

    let output = '';
    let lastIndex = 0;

    ranges.forEach(function (range) {
        output += escapeHtml(source.slice(lastIndex, range[0]));
        output += '<mark>' + escapeHtml(source.slice(range[0], range[1])) + '</mark>';
        lastIndex = range[1];
    });

    output += escapeHtml(source.slice(lastIndex));
    return output;
}

export function truncate(text, maxLength) {
    const normalized = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized.length <= maxLength) return normalized;

    let candidate = normalized.slice(0, maxLength + 1);
    const lastSpace = candidate.lastIndexOf(' ');

    if (lastSpace > Math.floor(maxLength * 0.6)) {
        candidate = candidate.slice(0, lastSpace);
    } else {
        candidate = normalized.slice(0, maxLength);
    }

    return candidate.replace(/[\s,.;:!?-]+$/, '').trim() + '…';
}

export function truncateTitle(text, maxLength) {
    const normalized = String(text || '')
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

    const firstNewline = normalized.indexOf('\n');
    const firstPeriod = normalized.indexOf('.');
    let cutIndex = -1;

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

export function markdownToPlainText(text) {
    const source = String(text || '')
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

export function markdownToTitleText(text) {
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
