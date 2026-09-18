const BITRATE_TABLE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_TABLE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLERATE_TABLE_V1 = [44100, 48000, 32000, 0];
const SAMPLERATE_TABLE_V2 = [22050, 24000, 16000, 0];
const SAMPLERATE_TABLE_V25 = [11025, 12000, 8000, 0];

export function findId3EndOffset(uint8) {
    if (uint8.length < 10) return 0;
    if (uint8[0] === 0x49 && uint8[1] === 0x44 && uint8[2] === 0x33) {
        const size = ((uint8[6] & 0x7F) << 21) |
                     ((uint8[7] & 0x7F) << 14) |
                     ((uint8[8] & 0x7F) << 7) |
                     (uint8[9] & 0x7F);
        const end = 10 + size;
        return Math.min(end, uint8.length);
    }
    return 0;
}

export function parseMp3FrameHeader(uint8, offset) {
    if (offset + 4 > uint8.length) return null;
    const b0 = uint8[offset];
    const b1 = uint8[offset + 1];
    const b2 = uint8[offset + 2];
    const b3 = uint8[offset + 3];

    if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return null;

    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) return null;

    const isV1 = versionBits === 3;
    const isV2 = versionBits === 2;
    const isV25 = versionBits === 0;

    const bitrateIdx = (b2 >> 4) & 0x0F;
    const samplerateIdx = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    if (bitrateIdx === 0 || bitrateIdx === 15) return null;
    if (samplerateIdx === 3) return null;

    let bitrate = 0;
    if (isV1) {
        bitrate = BITRATE_TABLE_V1_L3[bitrateIdx] * 1000;
    } else {
        bitrate = BITRATE_TABLE_V2_L3[bitrateIdx] * 1000;
    }

    let samplerate = 0;
    if (isV1) samplerate = SAMPLERATE_TABLE_V1[samplerateIdx];
    else if (isV2) samplerate = SAMPLERATE_TABLE_V2[samplerateIdx];
    else if (isV25) samplerate = SAMPLERATE_TABLE_V25[samplerateIdx];

    if (!samplerate || !bitrate) return null;

    const frameSize = isV1
        ? Math.floor((144 * bitrate) / samplerate) + padding
        : Math.floor((72 * bitrate) / samplerate) + padding;

    return { frameSize, samplerate, bitrate };
}

export function trimLeadingSilenceFromMp3(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8.length < 32) return arrayBuffer;

    let offset = findId3EndOffset(uint8);

    while (offset < uint8.length && uint8[offset] === 0x00) {
        offset++;
    }

    let firstValidSync = -1;
    for (let i = offset; i < Math.min(offset + 4096, uint8.length - 4); i++) {
        if (uint8[i] === 0xFF && (uint8[i + 1] & 0xE0) === 0xE0) {
            const frame = parseMp3FrameHeader(uint8, i);
            if (frame && frame.frameSize > 0) {
                firstValidSync = i;
                break;
            }
        }
    }

    if (firstValidSync > 0 && firstValidSync < uint8.length - 100) {
        return uint8.buffer.slice(firstValidSync, firstValidSync + uint8.byteLength - firstValidSync);
    }

    return arrayBuffer;
}

export function arrayBufferToBase64DataUrl(arrayBuffer, mimeType = 'audio/mpeg') {
    const trimmed = trimLeadingSilenceFromMp3(arrayBuffer);
    const bytes = new Uint8Array(trimmed);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const sub = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, sub);
    }
    const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
    return `data:${mimeType};base64,${base64}`;
}
