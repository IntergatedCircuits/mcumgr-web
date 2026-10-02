(function (root, factory) {
    const MCUTransport = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MCUTransport };
    } else {
        root.MCUTransport = MCUTransport;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    class MCUTransport {
        constructor(di = {}) {
            this._logger = di.logger || { info: console.log, error: console.error };
            this._userRequestedDisconnect = false;
            this._connectCallback = null;
            this._connectingCallback = null;
            this._disconnectCallback = null;
            this._rawMessageCallback = null;
        }

        onConnecting(callback) {
            this._connectingCallback = callback;
            return this;
        }

        onConnect(callback) {
            this._connectCallback = callback;
            return this;
        }

        onDisconnect(callback) {
            this._disconnectCallback = callback;
            return this;
        }

        onRawMessage(callback) {
            this._rawMessageCallback = callback;
            return this;
        }

        get smpVersion() {
            return 0;
        }

        get name() {
            return 'MCUmgr transport';
        }

        async connect() {
            throw new Error('connect() must be implemented by a transport');
        }

        async sendMessage() {
            throw new Error('sendMessage() must be implemented by a transport');
        }

        async disconnect() {
            this._userRequestedDisconnect = true;
        }

        _connecting() {
            if (this._connectingCallback) this._connectingCallback();
        }

        async _connected() {
            if (this._connectCallback) await this._connectCallback();
        }

        async _disconnected(error = null) {
            this._logger.info('Disconnected.');
            if (this._disconnectCallback) await this._disconnectCallback(error);
            this._userRequestedDisconnect = false;
        }

        _rawMessage(message) {
            if (this._rawMessageCallback) this._rawMessageCallback(message);
        }
    }

    return MCUTransport;
});