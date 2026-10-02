# MCU Manager (Web Bluetooth and Web Serial)

This browser tool communicates with MCUmgr devices over Bluetooth LE or serial. It implements SMP v1 and v2, using CBOR-encoded management requests for device control and firmware updates.

The protocol and transport client can also be installed as the `mcumgr-web` npm package. It provides ESM, CommonJS, and browser script-tag builds; see [API.md](API.md#installation) for installation and usage.

Choose the transport and SMP version supported by the device in the connection screen. Bluetooth uses the SMP GATT service; serial uses Zephyr's MCUmgr console framing.

> Prefer a command line? **[mcumgr-mac](https://github.com/boogie/mcumgr-mac)** is a
> native macOS CLI version of the same tool.

## Features

- **Firmware Upload**: Upload MCUboot-formatted firmware images over Bluetooth LE or serial
- **Fast Bluetooth Upload** (optional): larger chunks and pipelined writes for much faster transfers, with automatic fallback for devices that need conservative settings
- **Image Management**: Test, confirm, and erase firmware images
- **Device Control**: Reset device, send echo commands
- **Progress Tracking**: Real-time progress with live transfer speed and a time-remaining estimate
- **Auto-Reconnect**: Automatic reconnection and upload resumption on connection loss
- **Image Validation**: Pre-upload validation of MCUboot image format

## Quick Start

**Online:** Try MCU Manager by visiting **https://boogie.github.io/mcumgr-web/** with a supported browser.

**Local:** For Bluetooth, open `index.html` in a supported browser. For Serial, serve the folder from `localhost`, for example with `python3 -m http.server 8000`, then open `http://localhost:8000`.

**Note:** Web Bluetooth and Web Serial require a secure context: HTTPS or localhost.

## Browser Compatibility

Browser support changes over time. Check the browser compatibility data for each API:

- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

## Documentation

- **[API.md](API.md)** - Complete API reference and usage examples
- **[PROTOCOL.md](PROTOCOL.md)** - SMP protocol specification and MCUboot image format
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contributing guidelines and development setup

## Setting up on your machine

**Simple Method (Chrome & Edge):**

With the latest versions of Chrome and Edge, you can simply open `index.html` directly in your browser - no web server needed.

**Web Server Method (Optional):**

For other browsers or older versions, you can serve the files using a local web server:

Python:
```bash
python -m http.server 8000
```

Node.js:
```bash
npx http-server -p 8000
```

PHP:
```bash
php -S localhost:8000
```

Then visit http://localhost:8000/

## Usage Example

```javascript
// Create MCU Manager instance
const mcumgr = new MCUManager();

// Set up event handlers
mcumgr
  .onConnect(() => console.log('Connected!'))
  .onImageUploadProgress(({ percentage }) =>
    console.log(`Upload: ${percentage}%`)
  );

// Connect to device
await mcumgr.connect();

// Upload firmware
const response = await fetch('firmware.bin');
const imageBuffer = await response.arrayBuffer();
await mcumgr.cmdUpload(imageBuffer);
```

See [API.md](API.md) for complete documentation.

## Development

### Running Tests

This project uses Jest for automated testing. Protocol and transport tests run without physical devices using injected browser APIs and in-memory byte streams. Tests are also run on every git commit and in GitHub Actions.

Install dependencies:
```bash
npm install
```

Start the local web app at `http://localhost:8080`:
```bash
npm start
```

Run tests:
```bash
npm test
```

Run the CI-equivalent command locally:
```bash
npm run test:ci
```

Run tests in watch mode:
```bash
npm run test:watch
```

Generate coverage report:
```bash
npm run test:coverage
```

### Test Structure

- `__tests__/mcumgr.test.js` - Tests for the MCUManager class (connection, messaging, image upload, validation)
- `__tests__/smp.test.js` - SMP v1/v2 packet encoding, decoding, and stream reassembly
- `__tests__/serial-framing.test.js` - Zephyr console framing, CRC, fragmentation, and recovery
- `__tests__/transports.test.js` - Web Bluetooth and Web Serial adapters using injected APIs
- `__tests__/cbor.test.js` - Tests for CBOR encoding/decoding
- `__tests__/setup.js` - Test environment setup and mocks

The test suite covers:
- MCUManager transport selection and protocol handling
  - Constructor and dependency injection
  - Callback registration
  - Device connection and disconnection
  - Message protocol (SMP)
  - Image validation and parsing
  - Firmware upload with chunking
  - Command methods (reset, echo, image state, etc.)
  - Sequence number management
- Bluetooth and Serial transport behavior without browser hardware
- SMP v1/v2 packet handling and Zephyr serial console framing
- CBOR encoding/decoding
  - Primitive types (boolean, null, undefined)
  - Numbers (integers, floats, large numbers)
  - Strings (ASCII, UTF-8, long strings)
  - Byte arrays
  - Arrays and nested arrays
  - Objects and nested objects
  - Complex MCU Manager message structures

### Pre-commit Hooks

Tests are automatically run before each commit using Husky. If tests fail, the commit will be blocked. This ensures code quality and prevents regressions.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

We're especially looking for help with:
- Testing on different devices and browsers
- Adding support for additional SMP commands
- Improving documentation and examples
- Bug reports and feature requests

## License

See LICENSE file for details.

## Links

- **Live Demo:** https://boogie.github.io/mcumgr-web/
- **MCUboot:** https://www.mcuboot.com/
- **Apache Mynewt:** https://mynewt.apache.org/
- **Web Serial API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- **Web Bluetooth API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
