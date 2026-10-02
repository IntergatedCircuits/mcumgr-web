(function (root, factory) {
    const codec = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = codec;
    } else {
        root.McumgrSerialFraming = codec;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const START_MARKER = Uint8Array.from([0x06, 0x09]);
    const CONTINUATION_MARKER = Uint8Array.from([0x04, 0x14]);
    const MAX_FRAME_SIZE = 127;

    function toBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        }
        throw new TypeError('Serial data must be an ArrayBuffer or byte array');
    }

    function concat(parts, length) {
        const result = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
        }
        return result;
    }

    function crc16ITUT(seed, data) {
        let crc = seed & 0xffff;
        for (const byte of data) {
            crc = ((crc >> 8) | (crc << 8)) & 0xffff;
            crc ^= byte & 0xff;
            crc ^= (crc & 0xff) >> 4;
            crc ^= (crc << 12) & 0xffff;
            crc ^= (crc & 0xff) << 5;
        }
        return crc & 0xffff;
    }

    function encodeBase64(bytes) {
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
    }

    function decodeBase64(bytes) {
        let encoded = '';
        for (const byte of bytes) encoded += String.fromCharCode(byte);
        try {
            const binary = atob(encoded);
            return Uint8Array.from(binary, character => character.charCodeAt(0));
        } catch (_) {
            return null;
        }
    }

    class LineFramer {
        constructor(maxLineLength = 4096) {
            this._buffer = new Uint8Array();
            this._maxLineLength = maxLineLength;
        }

        push(chunk) {
            const bytes = toBytes(chunk);
            const combined = new Uint8Array(this._buffer.length + bytes.length);
            combined.set(this._buffer);
            combined.set(bytes, this._buffer.length);
            const lines = [];
            let start = 0;

            for (let index = 0; index < combined.length; index++) {
                if (combined[index] !== 0x0a) continue;
                let end = index;
                while (end > start && combined[end - 1] === 0x0d) end--;
                let lineStart = start;
                while (lineStart < end && combined[lineStart] === 0x0d) lineStart++;
                if (end - lineStart <= this._maxLineLength) {
                    lines.push(combined.slice(lineStart, end));
                }
                start = index + 1;
            }

            this._buffer = combined.slice(start);
            if (this._buffer.length > this._maxLineLength) this._buffer = new Uint8Array();
            return lines;
        }

        reset() {
            this._buffer = new Uint8Array();
        }
    }

    class ConsolePacketDecoder {
        constructor() {
            this.reset();
        }

        reset() {
            this._parts = [];
            this._decodedLength = 0;
            this._expectedLength = 0;
        }

        push(line) {
            const bytes = toBytes(line);
            if (bytes.length < 3) return null;

            const isStart = bytes[0] === START_MARKER[0] && bytes[1] === START_MARKER[1];
            const isContinuation = bytes[0] === CONTINUATION_MARKER[0] && bytes[1] === CONTINUATION_MARKER[1];
            if (isStart) {
                this.reset();
            } else if (!isContinuation || this._expectedLength === 0) {
                return null;
            }

            const decoded = decodeBase64(bytes.subarray(2));
            if (!decoded || decoded.length === 0) {
                this.reset();
                return null;
            }

            if (isStart) {
                if (decoded.length < 2) {
                    this.reset();
                    return null;
                }
                const packetLength = (decoded[0] << 8) | decoded[1];
                if (packetLength < 10) {
                    this.reset();
                    return null;
                }
                this._expectedLength = packetLength + 2;
            }

            this._parts.push(decoded);
            this._decodedLength += decoded.length;
            if (this._decodedLength > this._expectedLength) {
                this.reset();
                return null;
            }
            if (this._decodedLength < this._expectedLength) return null;

            const framed = concat(this._parts, this._decodedLength);
            const packet = framed.slice(2, framed.length - 2);
            const receivedCrc = (framed[framed.length - 2] << 8) | framed[framed.length - 1];
            const valid = crc16ITUT(0, packet) === receivedCrc;
            this.reset();
            return valid ? packet : null;
        }
    }

    class SerialConsoleCodec {
        constructor(options = {}) {
            this._maxFrameSize = options.maxFrameSize || MAX_FRAME_SIZE;
            this._lineFramer = new LineFramer();
            this._packetDecoder = new ConsolePacketDecoder();
        }

        encode(packet) {
            const bytes = toBytes(packet);
            const packetLength = bytes.length + 2;
            if (packetLength > 0xffff) throw new RangeError('Serial packet is too large');

            const framed = new Uint8Array(bytes.length + 4);
            framed[0] = (packetLength >> 8) & 0xff;
            framed[1] = packetLength & 0xff;
            framed.set(bytes, 2);
            const crc = crc16ITUT(0, bytes);
            framed[framed.length - 2] = (crc >> 8) & 0xff;
            framed[framed.length - 1] = crc & 0xff;

            const maxInputBytes = Math.floor((this._maxFrameSize - 3) / 4) * 3;
            const frames = [];
            for (let offset = 0; offset < framed.length; offset += maxInputBytes) {
                const encoded = encodeBase64(framed.subarray(offset, offset + maxInputBytes));
                const marker = offset === 0 ? START_MARKER : CONTINUATION_MARKER;
                const line = new Uint8Array(marker.length + encoded.length + 1);
                line.set(marker);
                for (let index = 0; index < encoded.length; index++) {
                    line[marker.length + index] = encoded.charCodeAt(index);
                }
                line[line.length - 1] = 0x0a;
                frames.push(line);
            }
            return frames;
        }

        push(chunk) {
            const packets = [];
            for (const line of this._lineFramer.push(chunk)) {
                const packet = this._packetDecoder.push(line);
                if (packet) packets.push(packet);
            }
            return packets;
        }

        reset() {
            this._lineFramer.reset();
            this._packetDecoder.reset();
        }
    }

    return { crc16ITUT, LineFramer, ConsolePacketDecoder, SerialConsoleCodec, MAX_FRAME_SIZE };
});