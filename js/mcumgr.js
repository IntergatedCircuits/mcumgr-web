
const CBOR = typeof module !== 'undefined' && module.exports
    ? require('./cbor.js')
    : globalThis.CBOR;
const SMP = typeof module !== 'undefined' && module.exports
    ? require('./protocol/smp.js')
    : globalThis.McumgrSmp;
const MCUTransportBluetooth = typeof module !== 'undefined' && module.exports
    ? require('./transports/bluetooth.js').MCUTransportBluetooth
    : globalThis.MCUTransportBluetooth;
const MCUTransportSerial = typeof module !== 'undefined' && module.exports
    ? require('./transports/serial.js').MCUTransportSerial
    : globalThis.MCUTransportSerial;
const {
    SMP_VERSION_1,
    SMP_VERSION_2,
    MGMT_OP_READ,
    MGMT_OP_READ_RSP,
    MGMT_OP_WRITE,
    MGMT_OP_WRITE_RSP,
    MGMT_GROUP_ID_OS,
    MGMT_GROUP_ID_IMAGE,
    MGMT_GROUP_ID_STAT,
    MGMT_GROUP_ID_CONFIG,
    MGMT_GROUP_ID_LOG,
    MGMT_GROUP_ID_CRASH,
    MGMT_GROUP_ID_SPLIT,
    MGMT_GROUP_ID_RUN,
    MGMT_GROUP_ID_FS,
    MGMT_GROUP_ID_SHELL,
    MGMT_GROUP_ID_ENUM,
    ENUM_MGMT_ID_COUNT,
    ENUM_MGMT_ID_LIST,
    ENUM_MGMT_ID_SINGLE,
    ENUM_MGMT_ID_DETAILS,
    OS_MGMT_ID_ECHO,
    OS_MGMT_ID_CONS_ECHO_CTRL,
    OS_MGMT_ID_TASKSTAT,
    OS_MGMT_ID_MPSTAT,
    OS_MGMT_ID_DATETIME_STR,
    OS_MGMT_ID_RESET,
    IMG_MGMT_ID_STATE,
    IMG_MGMT_ID_UPLOAD,
    IMG_MGMT_ID_FILE,
    IMG_MGMT_ID_CORELIST,
    IMG_MGMT_ID_CORELOAD,
    IMG_MGMT_ID_ERASE
} = SMP;

class MCUManager {
    constructor(di = {}) {
        this.SERVICE_UUID = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
        this.CHARACTERISTIC_UUID = 'da2e7828-fbce-4e01-ae9e-261174997c48';
        this._defaultMtu = di.mtu || 400;
        this._cbor = di.cbor || CBOR;
        this._crypto = di.crypto || globalThis.crypto;
        this._defaultMaxChunkSize = di.maxChunkSize || 128;
        this._mtu = this._defaultMtu;
        this._maxChunkSize = this._defaultMaxChunkSize;
        this._chunkDelay = di.chunkDelay || 50; // Add 50ms delay between chunks
        // "Fast upload" preset (opt-in via cmdUpload): bigger chunks and no
        // inter-chunk delay. Off by default so the tool stays compatible with
        // any device; the conservative values above are used when it is off.
        this._fast = false;
        // In fast mode assume a large MTU (macOS/Chrome negotiate ~512) so chunks
        // approach the link limit; a chunk that's actually too big is caught and
        // downgraded below, so this stays safe on devices with a smaller MTU.
        this._fastMtu = di.fastMtu || 500;
        this._fastMaxChunkSize = di.fastMaxChunkSize || 512;
        this._fastChunkDelay = di.fastChunkDelay !== undefined ? di.fastChunkDelay : 0;
        this._fastChunkCap = this._fastMaxChunkSize; // auto-downgrades if a chunk exceeds the MTU
        this._fastWindow = di.fastWindow || 8; // chunks kept in flight (pipelined) in fast mode
        // Windowed-upload state (re-initialised per upload in cmdUpload).
        this._window = 1;
        this._sendOffset = 0;
        this._pumping = false;
        // Throughput tracking (re-initialised per upload in cmdUpload).
        this._uploadStartTime = 0;
        this._speedSamples = [];
        this._transport = null;
        this._transportOptions = di.transportOptions || {};
        this._transportFactory = di.transportFactory || {
            bluetooth: options => new MCUTransportBluetooth(options),
            serial: options => new MCUTransportSerial(options)
        };
        this._smpVersion = di.smpVersion;
        this._connectCallback = null;
        this._connectingCallback = null;
        this._disconnectCallback = null;
        this._messageCallback = null;
        this._imageUploadProgressCallback = null;
        this._imageUploadErrorCallback = null;
        this._uploadIsInProgress = false;
        this._chunkTimeout = 5000; // 5000ms, if sending a chunk is not completed in this time, it will be retried
        this._consecutiveTimeouts = 0;
        this._maxConsecutiveTimeouts = 2; // After this many timeouts, try increasing timeout
        this._maxTotalTimeouts = 6; // After this many total timeouts, give up
        this._totalTimeouts = 0;
        this._logger = di.logger || { info: console.log, error: console.error };
        this._seq = 0;
        this._pendingRequests = new Map();
        this._responseTimeout = di.responseTimeout || 30000;
        this._userRequestedDisconnect = false;
        this._reconnectDelay = di.reconnectDelay || 1000;
    }
    set smpVersion(version) {
        if (version !== SMP_VERSION_1 && version !== SMP_VERSION_2) {
            throw new RangeError(`Unsupported SMP version ${version}`);
        }
        this._smpVersion = version;
    }
    get smpVersion() {
        if (this._smpVersion !== undefined) return this._smpVersion;
        return this._transport ? (this._transport.smpVersion ?? SMP_VERSION_1) : SMP_VERSION_1;
    }
    async connect(type = 'bluetooth', options) {
        if (typeof type !== 'string') {
            options = type;
            type = 'bluetooth';
        }
        const factory = this._transportFactory[type];
        if (!factory) throw new Error(`Unknown transport type: ${type}`);

        this._transport = factory({
            ...this._transportOptions,
            logger: this._logger,
            reconnectDelay: this._reconnectDelay
        });
        this._transportType = type;
        this._mtu = type === 'serial' ? 140 : this._defaultMtu;
        this._maxChunkSize = type === 'serial' ? 64 : this._defaultMaxChunkSize;
        this._chunkTimeoutDefault = type === 'serial' ? 10000 : 5000;
        this._chunkTimeoutMax = type === 'serial' ? 30000 : 15000;
        this._transport
            .onConnecting(() => this._connecting())
            .onConnect(() => this._connected())
            .onDisconnect(error => this._disconnected(error))
            .onRawMessage(message => this._processMessage(message));
        await this._transport.connect(options);
    }
    disconnect() {
        return this._transport ? this._transport.disconnect() : Promise.resolve();
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
    onMessage(callback) {
        this._messageCallback = callback;
        return this;
    }
    onImageUploadProgress(callback) {
        this._imageUploadProgressCallback = callback;
        return this;
    }
    onImageUploadFinished(callback) {
        this._imageUploadFinishedCallback = callback;
        return this;
    }
    onImageUploadError(callback) {
        this._imageUploadErrorCallback = callback;
        return this;
    }
    onImageUploadCancelled(callback) {
        this._imageUploadCancelledCallback = callback;
        return this;
    }
    async _connected() {
        if (this._connectCallback) await this._connectCallback();
        if (this._uploadIsInProgress) {
            setTimeout(() => this._uploadNext(), 2000);
        }
    }
    async _disconnected(error = null) {
        this._logger.info('Disconnected.');
        for (const request of this._pendingRequests.values()) {
            clearTimeout(request.timeoutId);
            request.reject(error || new Error('Disconnected before the response was received'));
        }
        this._pendingRequests.clear();
        if (this._disconnectCallback) this._disconnectCallback(error);
        this._transport = null;
        this._uploadIsInProgress = false;
        this._userRequestedDisconnect = false;
    }
    get name() {
        return this._transport && this._transport.name;
    }
    _connecting() {
        if (this._connectingCallback) this._connectingCallback();
    }
    async _sendMessage(op, group, id, data) {
        if (!this._transport) throw new Error('No MCUmgr transport is connected');
        const sequence = this._seq;
        this._seq = (sequence + 1) % 256;
        const payload = typeof data === 'undefined' ? new Uint8Array() : new Uint8Array(this._cbor.encode(data));
        const message = SMP.encodeMessage({
            op,
            group,
            sequence,
            id,
            version: this.smpVersion
        }, payload);
        await this._transport.sendMessage(message);
    }
    _requestMessage(op, group, id, data) {
        if (!this._transport) return Promise.reject(new Error('No MCUmgr transport is connected'));
        const sequence = this._seq;
        if (this._pendingRequests.has(sequence)) {
            return Promise.reject(new Error('An MCUmgr request is already pending for this sequence number'));
        }
        let timeoutId;
        const response = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                this._pendingRequests.delete(sequence);
                reject(new Error(`Timed out waiting for MCUmgr response (group ${group}, command ${id})`));
            }, this._responseTimeout);
            this._pendingRequests.set(sequence, {
                group,
                id,
                responseOp: op === MGMT_OP_READ ? MGMT_OP_READ_RSP : MGMT_OP_WRITE_RSP,
                resolve,
                reject,
                timeoutId
            });
        });
        this._sendMessage(op, group, id, data).catch(error => {
            const pendingRequest = this._pendingRequests.get(sequence);
            if (pendingRequest) {
                clearTimeout(pendingRequest.timeoutId);
                this._pendingRequests.delete(sequence);
                pendingRequest.reject(error);
            }
        });
        return response;
    }
    cmdEnumCount() {
        return this._requestMessage(MGMT_OP_READ, MGMT_GROUP_ID_ENUM, ENUM_MGMT_ID_COUNT);
    }
    cmdEnumList() {
        return this._requestMessage(MGMT_OP_READ, MGMT_GROUP_ID_ENUM, ENUM_MGMT_ID_LIST);
    }
    cmdEnumSingle(index) {
        return this._requestMessage(
            MGMT_OP_READ,
            MGMT_GROUP_ID_ENUM,
            ENUM_MGMT_ID_SINGLE,
            index === undefined ? {} : { index }
        );
    }
    cmdEnumDetails(groups) {
        const data = groups === undefined ? {} : { groups };
        return this._requestMessage(MGMT_OP_READ, MGMT_GROUP_ID_ENUM, ENUM_MGMT_ID_DETAILS, data);
    }
    _processMessage(message) {
        let packet;
        let data = {};
        try {
            packet = SMP.decodeMessage(message);
            if (packet.length > 0) {
                const payload = packet.payload;
                data = this._cbor.decode(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
            }
        } catch (error) {
            this._logger.error(`Invalid SMP response: ${error.message || error}`);
            return;
        }
        const { op, group, id, length, sequence } = packet;

        const pendingRequest = this._pendingRequests.get(sequence);
        if (pendingRequest && pendingRequest.group === group && pendingRequest.id === id && pendingRequest.responseOp === op) {
            clearTimeout(pendingRequest.timeoutId);
            this._pendingRequests.delete(sequence);
            pendingRequest.resolve(data);
        }

        if (group === MGMT_GROUP_ID_IMAGE && id === IMG_MGMT_ID_UPLOAD) {
            // Clear timeout since we received a response
            if (this._uploadTimeout) {
                clearTimeout(this._uploadTimeout);
            }

            // Check for error response
            const errorCode = data && data.err && typeof data.err.rc === 'number' ? data.err.rc : data && data.rc;
            if (errorCode !== undefined && errorCode !== 0) {
                this._uploadIsInProgress = false;
                const errorMessages = {
                    1: 'Unknown error',
                    2: 'Slot is busy or in bad state. Try erasing the slot first or confirming/testing pending images.',
                    3: 'Invalid value',
                    4: 'Operation timeout',
                    5: 'No entry found',
                    6: 'Bad state',
                    7: 'Response too large',
                    8: 'Not supported',
                    9: 'Data is corrupt',
                    10: 'Device is busy'
                };
                const errorMsg = errorMessages[errorCode] || `Device returned error code ${errorCode}`;
                this._logger.error(`Upload failed: ${errorMsg}`);
                if (this._imageUploadErrorCallback) {
                    this._imageUploadErrorCallback({
                        error: `Upload failed: ${errorMsg}`,
                        errorCode,
                        consecutiveTimeouts: this._consecutiveTimeouts,
                        totalTimeouts: this._totalTimeouts
                    });
                }
                return;
            }

            // Success response with offset
            if ((!data.err || data.err.rc === 0) && (data.rc === 0 || data.rc === undefined) && data.off !== undefined) {
                // Reset consecutive timeout counter on successful response
                this._consecutiveTimeouts = 0;
                this._uploadOffset = data.off;
                this._uploadNext();
                return;
            }
        }
        if (this._messageCallback) this._messageCallback({ op, group, id, data, length });
    }
    cmdReset() {
        return this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_OS, OS_MGMT_ID_RESET);
    }
    smpEcho(message) {
        return this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_OS, OS_MGMT_ID_ECHO, { d: message });
    }
    cmdImageState() {
        return this._sendMessage(MGMT_OP_READ, MGMT_GROUP_ID_IMAGE, IMG_MGMT_ID_STATE);
    }
    cmdImageErase() {
        return this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_IMAGE, IMG_MGMT_ID_ERASE, {});
    }
    cmdImageTest(hash) {
        return this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_IMAGE, IMG_MGMT_ID_STATE, { hash, confirm: false });
    }
    cmdImageConfirm(hash) {
        return this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_IMAGE, IMG_MGMT_ID_STATE, { hash, confirm: true });
    }
    _hash(image) {
        if (!this._crypto || !this._crypto.subtle) {
            throw new Error('Web Crypto is not available; provide it with the crypto option');
        }
        return this._crypto.subtle.digest('SHA-256', image);
    }
    // Build the progress payload. Speed is a moving average over a short
    // trailing window (several samples) so the readout and ETA stay stable
    // instead of jumping; `statsReady` is false until the window is meaningful,
    // so the caller can hold the display until the rate has settled.
    _uploadProgress(extra = {}) {
        const now = Date.now();
        const sent = this._uploadOffset;
        const total = this._uploadImage ? this._uploadImage.byteLength : 0;
        const elapsed = (now - this._uploadStartTime) / 1000;

        const WINDOW_MS = 4000;
        this._speedSamples.push({ t: now, offset: sent });
        while (this._speedSamples.length > 3 && now - this._speedSamples[0].t > WINDOW_MS) {
            this._speedSamples.shift();
        }
        const oldest = this._speedSamples[0];
        const dt = (now - oldest.t) / 1000;
        const statsReady = dt >= 0.75 && this._speedSamples.length >= 3;
        const kbps = statsReady && dt > 0 ? ((sent - oldest.offset) / 1024) / dt : 0;
        const avgKbps = elapsed > 0 ? (sent / 1024) / elapsed : 0;
        const etaSeconds = kbps > 0 ? Math.max(0, total - sent) / 1024 / kbps : 0;
        return {
            percentage: total > 0 ? Math.floor(sent / total * 100) : 0,
            bytesSent: sent,
            bytesTotal: total,
            kbps,
            avgKbps,
            etaSeconds,
            elapsedSeconds: elapsed,
            statsReady,
            ...extra,
        };
    }
    // Pump: keep up to `_window` chunks in flight. Called once to start the
    // upload and again on every acknowledgement (which advances _uploadOffset).
    async _uploadNext() {
        // Finished once the device has acknowledged the whole image.
        if (this._uploadOffset >= this._uploadImage.byteLength) {
            this._uploadIsInProgress = false;
            if (this._uploadTimeout) clearTimeout(this._uploadTimeout);
            const total = this._uploadImage.byteLength;
            const elapsedSeconds = (Date.now() - this._uploadStartTime) / 1000;
            const avgKbps = elapsedSeconds > 0 ? (total / 1024) / elapsedSeconds : 0;
            this._imageUploadFinishedCallback({ bytesTotal: total, elapsedSeconds, avgKbps });
            return;
        }

        // The send pointer must never lag the acknowledged offset (resynced here
        // and on timeout so un-acked chunks are resent).
        if (!(this._sendOffset >= this._uploadOffset)) {
            this._sendOffset = this._uploadOffset;
        }

        // (Re)arm the stall timeout — it only fires if acks stop advancing.
        if (this._uploadTimeout) clearTimeout(this._uploadTimeout);
        this._uploadTimeout = setTimeout(() => {
            this._consecutiveTimeouts++;
            this._totalTimeouts++;
            this._logger.info(`Upload chunk timeout (consecutive: ${this._consecutiveTimeouts}, total: ${this._totalTimeouts})`);
            if (this._totalTimeouts >= this._maxTotalTimeouts) {
                this._uploadIsInProgress = false;
                const error = `Upload failed: Device not responding after ${this._totalTimeouts} attempts. The device may be too slow or disconnected.`;
                this._logger.error(error);
                if (this._imageUploadErrorCallback) {
                    this._imageUploadErrorCallback({ error, consecutiveTimeouts: this._consecutiveTimeouts, totalTimeouts: this._totalTimeouts });
                }
                return;
            }
            if (this._consecutiveTimeouts >= this._maxConsecutiveTimeouts) {
                this._chunkTimeout = Math.min(this._chunkTimeout * 2, this._chunkTimeoutMax);
                this._logger.info(`Increased chunk timeout to ${this._chunkTimeout}ms`);
                if (this._imageUploadProgressCallback) {
                    this._imageUploadProgressCallback(this._uploadProgress({
                        timeoutAdjusted: true,
                        newTimeout: this._chunkTimeout
                    }));
                }
            }
            // Resend everything from the last acknowledged offset.
            this._sendOffset = this._uploadOffset;
            this._uploadNext();
        }, this._chunkTimeout);

        // Report progress against the acknowledged offset.
        this._imageUploadProgressCallback(this._uploadProgress());

        // Avoid two concurrent pumps: an ack arriving mid-send updates the offset
        // and timeout above, then returns; the running pump keeps the window full
        // from the refreshed state.
        if (this._pumping) return;
        this._pumping = true;
        try {
            const window = this._window || 1;
            const chunkEstimate = this._fast ? this._fastChunkCap : this._maxChunkSize;
            while (
                this._uploadIsInProgress &&
                this._sendOffset < this._uploadImage.byteLength &&
                (this._sendOffset - this._uploadOffset) < window * chunkEstimate
            ) {
                const len = await this._sendChunk(this._sendOffset);
                if (len === null) return; // hard failure already reported
                this._sendOffset += len;
            }
        } finally {
            this._pumping = false;
        }
    }

    // Build and write one upload chunk at `offset`. Returns the number of image
    // bytes sent, or null on a hard failure (already reported). Handles the
    // first-chunk metadata and the fast-mode "chunk too large" auto-downgrade.
    async _sendChunk(offset) {
        const nmpOverhead = 8;
        while (true) {
            const message = { data: new Uint8Array(), off: offset };
            if (offset === 0) {
                message.len = this._uploadImage.byteLength;
                message.sha = new Uint8Array(await this._hash(this._uploadImage));
            }
            const maxChunkSize = this._fast ? this._fastChunkCap : this._maxChunkSize;
            const mtu = this._fast ? this._fastMtu : this._mtu;
            const mtuBasedLength = mtu - this._cbor.encode(message).byteLength - nmpOverhead;
            const length = Math.min(mtuBasedLength, maxChunkSize);
            message.data = new Uint8Array(this._uploadImage.slice(offset, offset + length));

            const chunkDelay = this._fast ? this._fastChunkDelay : this._chunkDelay;
            if (chunkDelay > 0) await new Promise(resolve => setTimeout(resolve, chunkDelay));

            try {
                await this._sendMessage(MGMT_OP_WRITE, MGMT_GROUP_ID_IMAGE, IMG_MGMT_ID_UPLOAD, message);
                return message.data.byteLength;
            } catch (e) {
                // Almost always the chunk exceeding the device's negotiated MTU.
                // In fast mode, drop to the conservative chunk size and retry.
                if (this._fast && this._fastChunkCap > this._maxChunkSize) {
                    this._fastChunkCap = this._maxChunkSize;
                    this._logger.info('Chunk too large for this device; falling back to smaller chunks.');
                    continue;
                }
                this._uploadIsInProgress = false;
                if (this._uploadTimeout) clearTimeout(this._uploadTimeout);
                this._logger.error(`Upload write failed: ${e.message || e}`);
                if (this._imageUploadErrorCallback) {
                    this._imageUploadErrorCallback({ error: `Upload failed: ${e.message || e}` });
                }
                return null;
            }
        }
    }
    async cmdUpload(image, slot = 0, options = {}) {
        if (this._uploadIsInProgress) {
            this._logger.error('Upload is already in progress.');
            return;
        }
        this._uploadIsInProgress = true;

        this._uploadOffset = 0;
        this._uploadImage = image;
        this._uploadSlot = slot;

        // Fast-upload preset; reset the per-upload chunk auto-downgrade and the
        // windowed-send state. Fast mode pipelines several chunks; otherwise the
        // upload stays strictly sequential (window 1).
        this._fast = !!options.fast && this._transportType !== 'serial';
        this._fastChunkCap = this._fastMaxChunkSize;
        this._window = this._fast ? this._fastWindow : 1;
        this._sendOffset = 0;
        this._pumping = false;

        // Throughput tracking, for the live speed / ETA readout.
        this._uploadStartTime = Date.now();
        this._speedSamples = [];

        // Reset timeout tracking
        this._consecutiveTimeouts = 0;
        this._totalTimeouts = 0;
        this._chunkTimeout = this._chunkTimeoutDefault || 5000;

        this._uploadNext();
    }
    cancelUpload() {
        if (!this._uploadIsInProgress) {
            return;
        }

        // Clear timeout
        if (this._uploadTimeout) {
            clearTimeout(this._uploadTimeout);
        }

        // Reset upload state
        this._uploadIsInProgress = false;
        this._uploadOffset = 0;
        this._uploadImage = null;
        this._consecutiveTimeouts = 0;
        this._totalTimeouts = 0;

        this._logger.info('Upload cancelled by user');

        // Notify callback
        if (this._imageUploadCancelledCallback) {
            this._imageUploadCancelledCallback();
        }
    }
    // Given an ArrayBuffer, extract Tag-Value pairs and return them one by one.
    *_extractTlvs(data) {
        const view = new DataView(data);
        let offset = 0;
        while (offset < view.byteLength) {
            const tag = view.getUint16(offset, true);
            const len = view.getUint16(offset + 2, true);
            offset += 4;
            const valueData = view.buffer.slice(offset, offset + len);
            offset += len;

            yield { tag, value: new Uint8Array(valueData) };
        }
    }
    async imageInfo(image) {
        // https://interrupt.memfault.com/blog/mcuboot-overview#mcuboot-image-binaries

        const info = {};
        info.tags = {};
        const view = new DataView(image);

        // check header length
        if (view.byteLength < 32) {
            throw new Error('Invalid image (too short file)');
        }

        // check MAGIC bytes 0x96f3b83d
        if (view.getUint32(0, true) !== 0x96f3b83d) {
            throw new Error('Invalid image (wrong magic bytes)');
        }

        // check load address is 0x00000000
        if (view.getUint32(4, true) !== 0) {
            throw new Error('Invalid image (wrong load address)');
        }

        const headerSize = view.getUint16(8, true);

        // Protected TLV area is included in the hash
        const protected_tlv_length = view.getUint16(10, true);

        const imageSize = view.getUint32(12, true);
        info.imageSize = imageSize;

        // check image size is correct
        if (view.byteLength < imageSize + headerSize) {
            throw new Error('Invalid image (wrong image size)');
        }

        // check flags is 0x00000000
        if (view.getUint32(16, true) !== 0x00) {
            throw new Error('Invalid image (wrong flags)');
        }

        const version = `${view.getUint8(20)}.${view.getUint8(21)}.${view.getUint16(22, true)}`;
        info.version = version;

        const hashBytes = new Uint8Array(await this._hash(image.slice(0, imageSize + headerSize + protected_tlv_length)));
        info.hash = [...hashBytes].map(b => b.toString(16).padStart(2, '0')).join('');

        let offset = headerSize + imageSize;
        let tlv_end = offset;

        // Protected TLV area (included in the hash), if the header declared one.
        if (protected_tlv_length > 0) {
            // It must actually fit in the file.
            if (offset + protected_tlv_length > view.byteLength) {
                throw new Error('Invalid image (wrong protected TLV area size)');
            }
            // Verify the protected TLV magic bytes are valid.
            if (view.getUint16(offset, true) !== 0x6908) {
                throw new Error(`Expected protected TLV magic number. (0x${offset.toString(16)}: 0x${view.getUint16(offset, true).toString(16)})`);
            }

            // Find the end of the protected TLV region
            tlv_end = view.getUint16(offset + 2, true) + offset;
            // Store all tag-value pairs for the protected TLV region.
            for (let tlv of this._extractTlvs(view.buffer.slice(offset + 4, tlv_end))) {
                info.tags[tlv.tag] = tlv.value;
            }
            offset = tlv_end;
        }

        // Non-protected TLV area, if present. A real firmware always carries one
        // (it holds the image hash), but a minimal/synthetic image may omit it —
        // parse it when there's room, otherwise return the header info we have.
        if (offset + 4 <= view.byteLength) {
            if (view.getUint16(offset, true) !== 0x6907) {
                throw new Error(`Expected TLV magic number. (0x${offset.toString(16)}: 0x${view.getUint16(offset, true).toString(16)})`);
            }
            // Also include the non-protected TLVs in the tags map.
            // Assume there are no overlapping tag Ids.
            tlv_end = view.getUint16(offset + 2, true) + offset;
            for (let tlv of this._extractTlvs(view.buffer.slice(offset + 4, tlv_end))) {
                info.tags[tlv.tag] = tlv.value;
            }
        }

        // If the image hash tag is present, verify it matches what was calculated earlier.
        if (16 in info.tags && info.tags[16].length == hashBytes.length) {
            info.hashValid = info.tags[16].every((b, i) => b === hashBytes[i]);
        }

        return info;
    }
}

// Export for Node.js (testing) while keeping browser compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MCUManager,
        SMP_VERSION_1,
        SMP_VERSION_2,
        MCUTransportBluetooth,
        MCUTransportSerial,
        MGMT_OP_READ,
        MGMT_OP_READ_RSP,
        MGMT_OP_WRITE,
        MGMT_OP_WRITE_RSP,
        MGMT_GROUP_ID_OS,
        MGMT_GROUP_ID_IMAGE,
        MGMT_GROUP_ID_STAT,
        MGMT_GROUP_ID_CONFIG,
        MGMT_GROUP_ID_LOG,
        MGMT_GROUP_ID_CRASH,
        MGMT_GROUP_ID_SPLIT,
        MGMT_GROUP_ID_RUN,
        MGMT_GROUP_ID_FS,
        MGMT_GROUP_ID_SHELL,
        MGMT_GROUP_ID_ENUM,
        ENUM_MGMT_ID_COUNT,
        ENUM_MGMT_ID_LIST,
        ENUM_MGMT_ID_SINGLE,
        ENUM_MGMT_ID_DETAILS,
        OS_MGMT_ID_ECHO,
        OS_MGMT_ID_CONS_ECHO_CTRL,
        OS_MGMT_ID_TASKSTAT,
        OS_MGMT_ID_MPSTAT,
        OS_MGMT_ID_DATETIME_STR,
        OS_MGMT_ID_RESET,
        IMG_MGMT_ID_STATE,
        IMG_MGMT_ID_UPLOAD,
        IMG_MGMT_ID_FILE,
        IMG_MGMT_ID_CORELIST,
        IMG_MGMT_ID_CORELOAD,
        IMG_MGMT_ID_ERASE
    };
}
