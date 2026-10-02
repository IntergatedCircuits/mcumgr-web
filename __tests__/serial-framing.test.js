const SMP = require('../js/protocol/smp.js');
const { crc16ITUT, SerialConsoleCodec } = require('../js/transports/serial-framing.js');

describe('Zephyr serial console framing', () => {
    test('matches Zephyr CRC-16/ITU-T output', () => {
        expect(crc16ITUT(0, Buffer.from('123456789'))).toBe(0x31c3);
    });

    test('round-trips a fragmented packet across arbitrary stream reads', () => {
        const packet = SMP.encodeMessage(
            { version: SMP.SMP_VERSION_2, op: SMP.MGMT_OP_WRITE, group: 1, sequence: 23, id: 1 },
            new Uint8Array(240).fill(0x5a)
        );
        const encoder = new SerialConsoleCodec();
        const decoder = new SerialConsoleCodec();
        const frames = encoder.encode(packet);
        expect(frames.length).toBeGreaterThan(1);
        expect(frames.every(frame => frame.length <= 127)).toBe(true);

        const wireBytes = Buffer.concat(frames.map(frame => Buffer.from(frame)));
        const received = [];
        for (let offset = 0; offset < wireBytes.length; offset += 11) {
            received.push(...decoder.push(wireBytes.subarray(offset, offset + 11)));
        }

        expect(received).toHaveLength(1);
        expect(Array.from(received[0])).toEqual(Array.from(packet));
    });

    test('ignores console noise and recovers on the next packet start', () => {
        const codec = new SerialConsoleCodec();
        const packet = SMP.encodeMessage({ op: 2, group: 1, id: 1 }, new Uint8Array(240).fill(0x5a));
        const frames = codec.encode(packet);
        expect(codec.push(Buffer.from('boot log\r\n'))).toEqual([]);
        expect(codec.push(frames[0])).toEqual([]);

        const received = [];
        for (const frame of frames) received.push(...codec.push(frame));
        expect(received).toHaveLength(1);
        expect(Array.from(received[0])).toEqual(Array.from(packet));
    });
});