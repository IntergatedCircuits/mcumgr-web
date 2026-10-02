(function (root, factory) {
    const Base = typeof module !== 'undefined' && module.exports
        ? require('./base').MCUTransport
        : root.MCUTransport;
    const SMP = typeof module !== 'undefined' && module.exports
        ? require('../protocol/smp.js')
        : root.McumgrSmp;
    const MCUTransportBluetooth = factory(Base, SMP, root);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MCUTransportBluetooth };
    } else {
        root.MCUTransportBluetooth = MCUTransportBluetooth;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MCUTransport, SMP, root) {
    class MCUTransportBluetooth extends MCUTransport {
        constructor(di = {}) {
            super(di);
            this.SERVICE_UUID = di.serviceUuid || '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
            this.CHARACTERISTIC_UUID = di.characteristicUuid || 'da2e7828-fbce-4e01-ae9e-261174997c48';
            this._bluetooth = di.bluetoothApi || (root.navigator && root.navigator.bluetooth);
            this._device = null;
            this._service = null;
            this._characteristic = null;
            this._streamDecoder = new SMP.SmpStreamDecoder();
            this._reconnectDelay = di.reconnectDelay || 1000;
        }

        async connect(filters) {
            try {
                if (!this._bluetooth) throw new Error('Web Bluetooth is not available in this browser');
                const params = { acceptAllDevices: true, optionalServices: [this.SERVICE_UUID] };
                if (filters) {
                    params.filters = filters;
                    params.acceptAllDevices = false;
                }
                this._device = await this._bluetooth.requestDevice(params);
                this._logger.info(`Connecting to device ${this.name}...`);
                this._device.addEventListener('gattserverdisconnected', event => {
                    this._logger.info(event);
                    if (this._userRequestedDisconnect) {
                        this._disconnected();
                    } else {
                        this._logger.info('Trying to reconnect');
                        this._connectInternal(this._reconnectDelay);
                    }
                });
                await this._connectInternal(0);
            } catch (error) {
                this._logger.error(error);
                await this._disconnected(error);
            }
        }

        async _connectInternal(delay) {
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            if (!this._device) return;
            try {
                this._connecting();
                const server = await this._device.gatt.connect();
                this._service = await server.getPrimaryService(this.SERVICE_UUID);
                this._characteristic = await this._service.getCharacteristic(this.CHARACTERISTIC_UUID);
                this._characteristic.addEventListener('characteristicvaluechanged', event => {
                    const value = event.target.value;
                    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
                    for (const packet of this._streamDecoder.push(bytes)) this._rawMessage(packet);
                });
                await this._characteristic.startNotifications();
                await this._connected();
            } catch (error) {
                this._logger.error(error);
                await this._disconnected(delay === 0 ? error : null);
            }
        }

        async disconnect() {
            await super.disconnect();
            if (this._device && this._device.gatt) this._device.gatt.disconnect();
        }

        async sendMessage(data) {
            if (!this._characteristic) throw new Error('Bluetooth device is not connected');
            return this._characteristic.writeValueWithoutResponse(data);
        }

        async _disconnected(error = null) {
            this._device = null;
            this._service = null;
            this._characteristic = null;
            this._streamDecoder.reset();
            await super._disconnected(error);
        }

        get name() {
            return this._device && this._device.name;
        }
    }

    return MCUTransportBluetooth;
});