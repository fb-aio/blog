// Adapted from https://github.com/evanw/thumbhash (MIT).

export function thumbHashToRGBA(hash) {
    const { PI, min, max, cos, round } = Math;
    const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
    const header16 = hash[3] | (hash[4] << 8);
    const lDc = (header24 & 63) / 63;
    const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
    const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
    const lScale = ((header24 >> 18) & 31) / 31;
    const hasAlpha = header24 >> 23;
    const pScale = ((header16 >> 3) & 63) / 63;
    const qScale = ((header16 >> 9) & 63) / 63;
    const isLandscape = header16 >> 15;
    const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
    const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
    const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1;
    const aScale = (hash[5] >> 4) / 15;
    const acStart = hasAlpha ? 6 : 5;
    let acIndex = 0;

    function decodeChannel(nx, ny, scale) {
        const ac = [];
        for (let cy = 0; cy < ny; cy += 1) {
            for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx += 1) {
                ac.push((((hash[acStart + (acIndex >> 1)] >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
            }
        }
        return ac;
    }

    const lAc = decodeChannel(lx, ly, lScale);
    const pAc = decodeChannel(3, 3, pScale * 1.25);
    const qAc = decodeChannel(3, 3, qScale * 1.25);
    const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : null;
    const ratio = thumbHashToApproximateAspectRatio(hash);
    const w = round(ratio > 1 ? 32 : 32 * ratio);
    const h = round(ratio > 1 ? 32 / ratio : 32);
    const rgba = new Uint8Array(w * h * 4);
    const fx = [];
    const fy = [];

    for (let y = 0, i = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1, i += 4) {
            let l = lDc;
            let p = pDc;
            let q = qDc;
            let a = aDc;

            for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx += 1) {
                fx[cx] = cos(PI / w * (x + 0.5) * cx);
            }
            for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy += 1) {
                fy[cy] = cos(PI / h * (y + 0.5) * cy);
            }

            for (let cy = 0, j = 0; cy < ly; cy += 1) {
                for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx += 1, j += 1) {
                    l += lAc[j] * fx[cx] * fy2;
                }
            }

            for (let cy = 0, j = 0; cy < 3; cy += 1) {
                for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 3 - cy; cx += 1, j += 1) {
                    const factor = fx[cx] * fy2;
                    p += pAc[j] * factor;
                    q += qAc[j] * factor;
                }
            }

            if (hasAlpha && aAc) {
                for (let cy = 0, j = 0; cy < 5; cy += 1) {
                    for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 5 - cy; cx += 1, j += 1) {
                        a += aAc[j] * fx[cx] * fy2;
                    }
                }
            }

            const b = l - (2 / 3) * p;
            const r = (3 * l - b + q) / 2;
            const g = r - q;
            rgba[i] = max(0, 255 * min(1, r));
            rgba[i + 1] = max(0, 255 * min(1, g));
            rgba[i + 2] = max(0, 255 * min(1, b));
            rgba[i + 3] = max(0, 255 * min(1, a));
        }
    }

    return { w, h, rgba };
}

export function thumbHashToApproximateAspectRatio(hash) {
    const header = hash[3];
    const hasAlpha = hash[2] & 0x80;
    const isLandscape = hash[4] & 0x80;
    const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
    const ly = isLandscape ? header & 7 : hasAlpha ? 5 : 7;
    return lx / ly;
}

export function rgbaToDataURL(w, h, rgba) {
    const row = w * 4 + 1;
    const idat = 6 + h * (5 + row);
    const bytes = [
        137, 80, 78, 71, 13, 10, 26, 10,
        0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, w >> 8, w & 255, 0, 0, h >> 8, h & 255,
        8, 6, 0, 0, 0, 0, 0, 0, 0,
        idat >>> 24, (idat >> 16) & 255, (idat >> 8) & 255, idat & 255,
        73, 68, 65, 84, 120, 1
    ];
    const table = [0, 498536548, 997073096, 651767980, 1994146192, 1802195444, 1303535960, 1342533948, -306674912, -267414716, -690576408, -882789492, -1687895376, -2032938284, -1609899400, -1111625188];
    let a = 1;
    let b = 0;

    for (let y = 0, i = 0, end = row - 1; y < h; y += 1, end += row - 1) {
        bytes.push(y + 1 < h ? 0 : 1, row & 255, row >> 8, ~row & 255, (row >> 8) ^ 255, 0);
        for (b = (b + a) % 65521; i < end; i += 1) {
            const value = rgba[i] & 255;
            bytes.push(value);
            a = (a + value) % 65521;
            b = (b + a) % 65521;
        }
    }

    bytes.push(b >> 8, b & 255, a >> 8, a & 255, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130);

    for (const span of [[12, 29], [37, 41 + idat]]) {
        let [start, end] = span;
        let checksum = ~0;
        for (let i = start; i < end; i += 1) {
            checksum ^= bytes[i];
            checksum = (checksum >>> 4) ^ table[checksum & 15];
            checksum = (checksum >>> 4) ^ table[checksum & 15];
        }
        checksum = ~checksum;
        bytes[end++] = checksum >>> 24;
        bytes[end++] = (checksum >> 16) & 255;
        bytes[end++] = (checksum >> 8) & 255;
        bytes[end++] = checksum & 255;
    }

    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return 'data:image/png;base64,' + btoa(binary);
}

export function thumbHashToDataURL(hash) {
    const image = thumbHashToRGBA(hash);
    return rgbaToDataURL(image.w, image.h, image.rgba);
}
