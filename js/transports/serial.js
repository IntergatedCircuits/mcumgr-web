(function (root, factory) {
    const Base = typeof module !== 'undefined' && module.exports
        ? require('./base').MCUTransport
        : root.MCUTransport;
    const Framing = typeof module !== 'undefined' && module.exports
        ? require('./serial-framing.js')
        : root.McumgrSerialFraming;
    const MCUTransportSerial = factory(Base, Framing, root);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MCUTransportSerial };
    } else {
        root.MCUTransportSerial = MCUTransportSerial;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MCUTransport, Framing, root) {
    class MCUTransportSerial extends MCUTransport {
        constructor(di = {}) {
            super(di);
            this._serial = di.serialApi || (root.navigator && root.navigator.serial);
            this._baudRate = di.baudRate || 115200;
            this._port = null;
            this._reader = null;
            this._writer = null;
            this._codec = new Framing.SerialConsoleCodec();
            this._flushed = false;
        }

        async connect(options = {}) {
            try {
                if (!this._serial) throw new Error('Web Serial is not available in this browser');
                this._connecting();
                const portOptions = Array.isArray(options) ? { filters: options } : options;
                this._port = await this._serial.requestPort(portOptions);
                this._port.addEventListener('disconnect', event => {
                    this._logger.info(event);
                    if (!this._userRequestedDisconnect) this._disconnected();
                });
                await this._port.open({ baudRate: this._baudRate });
                if (!this._port.readable || !this._port.writable) {
                    throw new Error('Serial port does not provide readable and writable streams');
                }
                this._reader = this._port.readable.getReader();
                this._writer = this._port.writable.getWriter();
                this._flushed = false;
                this._readIncoming();
                await this._connected();
            } catch (error) {
                this._logger.error(error);
                await this._disconnected(error);
            }
        }

        async _readIncoming() {
            try {
                while (this._reader) {
                    const { value, done } = await this._reader.read();
                    if (done) break;
                    if (!value) continue;
                    for (const packet of this._codec.push(value)) this._rawMessage(packet);
                }
                if (!this._userRequestedDisconnect && this._port) await this._disconnected();
            } catch (error) {
                this._logger.info(error);
                if (!this._userRequestedDisconnect) await this._disconnected(error);
            }
        }

        async sendMessage(data) {
            if (!this._writer) throw new Error('Serial device is not connected');
            if (!this._flushed) {
                await this._writer.write(Uint8Array.from([0x0d, 0x0a]));
                this._flushed = true;
            }
            for (const frame of this._codec.encode(data)) await this._writer.write(frame);
        }

        async disconnect() {
            await super.disconnect();
            try {
                if (this._reader) await this._reader.cancel();
                if (this._writer) await this._writer.close();
                if (this._port) await this._port.close();
            } catch (error) {
                this._logger.info(error);
            } finally {
                await this._disconnected();
            }
        }

        async _disconnected(error = null) {
            this._reader = null;
            this._writer = null;
            this._port = null;
            this._codec.reset();
            this._flushed = false;
            await super._disconnected(error);
        }

        get name() {
            if (!this._port || !this._port.getInfo) return 'Serial';
            const info = this._port.getInfo();
            if (info.usbVendorId === undefined) return 'Serial';
            return `Serial ${info.usbVendorId.toString(16)}:${(info.usbProductId || 0).toString(16)}`;
        }
    }

    return MCUTransportSerial;
});