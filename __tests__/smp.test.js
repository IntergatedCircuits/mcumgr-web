const SMP = require('../js/protocol/smp.js');

describe('SMP packet codec', () => {
    test('encodes the Zephyr-compatible SMP v1 header', () => {
        const packet = SMP.encodeMessage({
            op: SMP.MGMT_OP_READ,
            group: SMP.MGMT_GROUP_ID_IMAGE,
            sequence: 0x2a,
            id: SMP.IMG_MGMT_ID_STATE
        });

        expect(Array.from(packet)).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x2a, 0x00]);
        expect(SMP.decodeMessage(packet)).toMatchObject({ version: SMP.SMP_VERSION_1, op: 0, group: 1, sequence: 0x2a, id: 0, length: 0 });
    });

    test('encodes SMP v2 in the version field without changing the operation', () => {
        const payload = Uint8Array.from([0xa1, 0x62, 0x72, 0x63, 0x00]);
        const packet = SMP.encodeMessage({
            version: SMP.SMP_VERSION_2,
            op: SMP.MGMT_OP_WRITE,
            group: SMP.MGMT_GROUP_ID_OS,
            sequence: 7,
            id: SMP.OS_MGMT_ID_ECHO
        }, payload);

        expect(packet[0]).toBe(0x0a);
        expect(SMP.decodeMessage(packet)).toMatchObject({ version: SMP.SMP_VERSION_2, op: 2, length: payload.length });
        expect(Array.from(SMP.decodeMessage(packet).payload)).toEqual(Array.from(payload));
    });

    test('rejects unsupported versions and truncated or mismatched packets', () => {
        expect(() => SMP.encodeMessage({ version: 2, op: 0, group: 0, id: 0 })).toThrow('Unsupported SMP version');
        expect(() => SMP.decodeMessage(new Uint8Array(7))).toThrow('shorter than its header');
        expect(() => SMP.decodeMessage(Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]))).toThrow('payload length mismatch');
    });

    test('reassembles partial reads and emits multiple packets in one read', () => {
        const decoder = new SMP.SmpStreamDecoder();
        const first = SMP.encodeMessage({ op: 0, group: 1, id: 0 });
        const second = SMP.encodeMessage({ version: 1, op: 2, group: 0, id: 0 }, Uint8Array.from([1, 2]));
        const joined = new Uint8Array(first.length + second.length);
        joined.set(first);
        joined.set(second, first.length);

        expect(decoder.push(joined.subarray(0, 5))).toEqual([]);
        const packets = decoder.push(joined.subarray(5));
        expect(packets).toHaveLength(2);
        expect(SMP.decodeMessage(packets[0]).version).toBe(SMP.SMP_VERSION_1);
        expect(SMP.decodeMessage(packets[1]).version).toBe(SMP.SMP_VERSION_2);
    });
});