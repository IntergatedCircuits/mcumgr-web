const SMP = require('../js/protocol/smp.js');
const { MCUTransportBluetooth } = require('../js/transports/bluetooth.js');
const { MCUTransportSerial } = require('../js/transports/serial.js');
const { SerialConsoleCodec } = require('../js/transports/serial-framing.js');

describe('Bluetooth transport', () => {
    test('connects through injected Web Bluetooth APIs and sends SMP bytes', async () => {
        const listeners = {};
        const characteristic = {
            addEventListener: jest.fn((name, callback) => { listeners[name] = callback; }),
            startNotifications: jest.fn().mockResolvedValue(undefined),
            writeValueWithoutResponse: jest.fn().mockResolvedValue(undefined)
        };
        const device = {
            name: 'test-device',
            addEventListener: jest.fn(),
            gatt: {
                connect: jest.fn().mockResolvedValue({
                    getPrimaryService: jest.fn().mockResolvedValue({
                        getCharacteristic: jest.fn().mockResolvedValue(characteristic)
                    })
                }),
                disconnect: jest.fn()
            }
        };
        const bluetoothApi = { requestDevice: jest.fn().mockResolvedValue(device) };
        const transport = new MCUTransportBluetooth({ bluetoothApi, logger: { info: jest.fn(), error: jest.fn() } });
        const connected = jest.fn();
        const received = jest.fn();
        transport.onConnect(connected).onRawMessage(received);

        await transport.connect([{ name: 'test-device' }]);
        const packet = SMP.encodeMessage({ op: SMP.MGMT_OP_READ, group: 1, id: 0 });
        listeners.characteristicvaluechanged({ target: { value: new DataView(packet.buffer) } });
        await transport.sendMessage(packet);

        expect(bluetoothApi.requestDevice).toHaveBeenCalledWith(expect.objectContaining({
            acceptAllDevices: false,
            filters: [{ name: 'test-device' }]
        }));
        expect(connected).toHaveBeenCalledTimes(1);
        expect(received).toHaveBeenCalledWith(packet);
        expect(characteristic.writeValueWithoutResponse).toHaveBeenCalledWith(packet);
        expect(transport.name).toBe('test-device');
    });
});

describe('Serial transport', () => {
    test('opens an injected serial port and writes Zephyr console-framed SMP data', async () => {
        const writes = [];
        let finishRead;
        const port = {
            addEventListener: jest.fn(),
            open: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
            getInfo: () => ({ usbVendorId: 0x1915, usbProductId: 0x521f }),
            readable: {
                getReader: () => ({
                    read: () => new Promise(resolve => { finishRead = resolve; }),
                    cancel: async () => { if (finishRead) finishRead({ done: true }); }
                })
            },
            writable: {
                getWriter: () => ({
                    write: async chunk => writes.push(Uint8Array.from(chunk)),
                    close: jest.fn().mockResolvedValue(undefined)
                })
            }
        };
        const serialApi = { requestPort: jest.fn().mockResolvedValue(port) };
        const transport = new MCUTransportSerial({ serialApi, baudRate: 230400, logger: { info: jest.fn(), error: jest.fn() } });
        const connected = jest.fn();
        transport.onConnect(connected);

        await transport.connect();
        const packet = SMP.encodeMessage({ version: SMP.SMP_VERSION_2, op: 2, group: 1, sequence: 9, id: 1 });
        await transport.sendMessage(packet);

        expect(serialApi.requestPort).toHaveBeenCalledWith({});
        expect(port.open).toHaveBeenCalledWith({ baudRate: 230400 });
        expect(connected).toHaveBeenCalledTimes(1);
        expect(transport.name).toBe('Serial 1915:521f');
        expect(Array.from(writes[0])).toEqual([0x0d, 0x0a]);

        const decoder = new SerialConsoleCodec();
        const echoedPacket = writes.slice(1).flatMap(frame => decoder.push(frame));
        expect(echoedPacket).toHaveLength(1);
        expect(Array.from(echoedPacket[0])).toEqual(Array.from(packet));

        await transport.disconnect();
        expect(port.close).toHaveBeenCalledTimes(1);
    });
});