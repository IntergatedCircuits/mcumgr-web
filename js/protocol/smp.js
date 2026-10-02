(function (root, factory) {
    const protocol = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = protocol;
    } else {
        root.McumgrSmp = protocol;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SMP_HEADER_LENGTH = 8;
    const SMP_VERSION_1 = 0;
    const SMP_VERSION_2 = 1;

    const constants = {
        MGMT_OP_READ: 0,
        MGMT_OP_READ_RSP: 1,
        MGMT_OP_WRITE: 2,
        MGMT_OP_WRITE_RSP: 3,
        MGMT_GROUP_ID_OS: 0,
        MGMT_GROUP_ID_IMAGE: 1,
        MGMT_GROUP_ID_STAT: 2,
        MGMT_GROUP_ID_CONFIG: 3,
        MGMT_GROUP_ID_LOG: 4,
        MGMT_GROUP_ID_CRASH: 5,
        MGMT_GROUP_ID_SPLIT: 6,
        MGMT_GROUP_ID_RUN: 7,
        MGMT_GROUP_ID_FS: 8,
        MGMT_GROUP_ID_SHELL: 9,
        MGMT_GROUP_ID_ENUM: 10,
        ENUM_MGMT_ID_COUNT: 0,
        ENUM_MGMT_ID_LIST: 1,
        ENUM_MGMT_ID_SINGLE: 2,
        ENUM_MGMT_ID_DETAILS: 3,
        OS_MGMT_ID_ECHO: 0,
        OS_MGMT_ID_CONS_ECHO_CTRL: 1,
        OS_MGMT_ID_TASKSTAT: 2,
        OS_MGMT_ID_MPSTAT: 3,
        OS_MGMT_ID_DATETIME_STR: 4,
        OS_MGMT_ID_RESET: 5,
        IMG_MGMT_ID_STATE: 0,
        IMG_MGMT_ID_UPLOAD: 1,
        IMG_MGMT_ID_FILE: 2,
        IMG_MGMT_ID_CORELIST: 3,
        IMG_MGMT_ID_CORELOAD: 4,
        IMG_MGMT_ID_ERASE: 5
    };

    function toBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        }
        throw new TypeError('SMP payload must be an ArrayBuffer or byte array');
    }

    function assertInteger(name, value, maximum) {
        if (!Number.isInteger(value) || value < 0 || value > maximum) {
            throw new RangeError(`${name} must be an integer between 0 and ${maximum}`);
        }
    }

    function encodeMessage(header, payload = new Uint8Array()) {
        const body = toBytes(payload);
        const version = header.version === undefined ? SMP_VERSION_1 : header.version;
        const flags = header.flags === undefined ? 0 : header.flags;
        const sequence = header.sequence === undefined ? 0 : header.sequence;

        if (version !== SMP_VERSION_1 && version !== SMP_VERSION_2) {
            throw new RangeError(`Unsupported SMP version ${version}`);
        }
        assertInteger('op', header.op, 7);
        assertInteger('flags', flags, 255);
        assertInteger('group', header.group, 65535);
        assertInteger('sequence', sequence, 255);
        assertInteger('id', header.id, 255);
        assertInteger('payload length', body.length, 65535);

        const packet = new Uint8Array(SMP_HEADER_LENGTH + body.length);
        packet[0] = (version << 3) | header.op;
        packet[1] = flags;
        packet[2] = (body.length >> 8) & 0xff;
        packet[3] = body.length & 0xff;
        packet[4] = (header.group >> 8) & 0xff;
        packet[5] = header.group & 0xff;
        packet[6] = sequence;
        packet[7] = header.id;
        packet.set(body, SMP_HEADER_LENGTH);
        return packet;
    }

    function decodeMessage(packet) {
        const bytes = toBytes(packet);
        if (bytes.length < SMP_HEADER_LENGTH) {
            throw new RangeError('SMP packet is shorter than its header');
        }

        const version = (bytes[0] >> 3) & 0x03;
        if (version !== SMP_VERSION_1 && version !== SMP_VERSION_2) {
            throw new RangeError(`Unsupported SMP version ${version}`);
        }

        const length = (bytes[2] << 8) | bytes[3];
        if (bytes.length !== SMP_HEADER_LENGTH + length) {
            throw new RangeError(`SMP payload length mismatch: header says ${length}, packet has ${bytes.length - SMP_HEADER_LENGTH}`);
        }

        return {
            version,
            op: bytes[0] & 0x07,
            flags: bytes[1],
            length,
            group: (bytes[4] << 8) | bytes[5],
            sequence: bytes[6],
            id: bytes[7],
            payload: bytes.slice(SMP_HEADER_LENGTH)
        };
    }

    class SmpStreamDecoder {
        constructor() {
            this._buffer = new Uint8Array();
        }

        push(chunk) {
            const bytes = toBytes(chunk);
            const combined = new Uint8Array(this._buffer.length + bytes.length);
            combined.set(this._buffer);
            combined.set(bytes, this._buffer.length);
            this._buffer = combined;

            const packets = [];
            while (this._buffer.length >= SMP_HEADER_LENGTH) {
                const payloadLength = (this._buffer[2] << 8) | this._buffer[3];
                const packetLength = SMP_HEADER_LENGTH + payloadLength;
                if (this._buffer.length < packetLength) break;
                packets.push(this._buffer.slice(0, packetLength));
                this._buffer = this._buffer.slice(packetLength);
            }
            return packets;
        }

        reset() {
            this._buffer = new Uint8Array();
        }
    }

    return {
        SMP_HEADER_LENGTH,
        SMP_VERSION_1,
        SMP_VERSION_2,
        ...constants,
        encodeMessage,
        decodeMessage,
        SmpStreamDecoder
    };
});