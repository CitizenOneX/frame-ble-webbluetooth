/**
 * Class for managing a connection and transferring data to and from
 * the Brilliant Labs Frame device over Bluetooth LE using WebBluetooth
 */
export class FrameBle {
    private device?: BluetoothDevice;
    private server?: BluetoothRemoteGATTServer;
    private txCharacteristic?: BluetoothRemoteGATTCharacteristic;
    private rxCharacteristic?: BluetoothRemoteGATTCharacteristic;

    private readonly SERVICE_UUID = "7a230001-5475-a6a4-654c-8431f6ad49c4";
    private readonly TX_CHARACTERISTIC_UUID = "7a230002-5475-a6a4-654c-8431f6ad49c4";
    private readonly RX_CHARACTERISTIC_UUID = "7a230003-5475-a6a4-654c-8431f6ad49c4";

    private awaitingPrintResponse = false;
    private awaitingDataResponse = false;
    private printResponsePromise?: Promise<string>;
    private printResolve?: (value: string) => void;
    private dataResponsePromise?: Promise<ArrayBuffer>;
    private dataResolve?: (value: ArrayBuffer) => void;

    private onDataResponse?: (data: ArrayBuffer) => void | Promise<void>;
    private onPrintResponse?: (data: string) => void | Promise<void>;
    private onDisconnectHandler?: () => void;

    constructor() {}

    private handleDisconnect = () => {
        this.device = undefined;
        this.server = undefined;
        this.txCharacteristic = undefined;
        this.rxCharacteristic = undefined;
        if (this.onDisconnectHandler) {
            this.onDisconnectHandler();
        }
    }

    private notificationHandler = (event: Event) => {
        const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
        const value = characteristic.value; // This is a DataView
        if (!value) return;

        const dataArrayBuffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); // Get the underlying ArrayBuffer

        if (value.getUint8(0) === 1) { // Data response
            const actualData = dataArrayBuffer.slice(1);
            if (this.awaitingDataResponse && this.dataResolve) {
                this.awaitingDataResponse = false;
                this.dataResolve(actualData);
            }
            if (this.onDataResponse) {
                const result = this.onDataResponse(actualData);
                if (result instanceof Promise) {
                    result.catch(console.error);
                }
            }
        } else { // Print response (string)
            const decodedString = new TextDecoder().decode(dataArrayBuffer);
            if (this.awaitingPrintResponse && this.printResolve) {
                this.awaitingPrintResponse = false;
                this.printResolve(decodedString);
            }
            if (this.onPrintResponse) {
                 const result = this.onPrintResponse(decodedString);
                 if (result instanceof Promise) {
                    result.catch(console.error);
                }
            }
        }
    }

    /**
    Connects to the first Frame device discovered,
    optionally matching a specified name e.g. "Frame AB",
    or throws an Exception if a matching Frame is not found within timeout seconds.

    `name` can optionally be provided as the local name containing the
    2 digit ID shown on Frame, in order to only connect to that specific device.
    The value should be a string, for example `"Frame 4F"`

    `print_response_handler` and `data_response_handler` can be provided and
    will be called whenever data arrives from the device asynchronously.

    `disconnect_handler` can be provided to be called to run
    upon a disconnect.
    */
    public async connect(
        options: {
            name?: string;
            namePrefix?: string;
            // timeout?: number; // Timeout for requestDevice is browser-handled
            printResponseHandler?: (data: string) => void | Promise<void>;
            dataResponseHandler?: (data: ArrayBuffer) => void | Promise<void>;
            disconnectHandler?: () => void;
        } = {}
    ): Promise<string | undefined> {
        if (!navigator.bluetooth) {
            throw new Error("Web Bluetooth API not available.");
        }

        this.onPrintResponse = options.printResponseHandler;
        this.onDataResponse = options.dataResponseHandler;
        this.onDisconnectHandler = options.disconnectHandler;

        // Create the filter with all properties at once
        const baseFilter: BluetoothLEScanFilter = options.name
            ? { services: [this.SERVICE_UUID], name: options.name }
            : options.namePrefix
                ? { services: [this.SERVICE_UUID], namePrefix: options.namePrefix }
                : { services: [this.SERVICE_UUID] };

        const deviceOptions: RequestDeviceOptions = {
            filters: [baseFilter], // Use the constructed filter
            optionalServices: [this.SERVICE_UUID], // Still good to request optional access
        };

        // The rest of your connect method...
        try {
            this.device = await navigator.bluetooth.requestDevice(deviceOptions);
            if (!this.device) {
                throw new Error("No device selected or found.");
            }

            this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

            this.server = await this.device.gatt!.connect();
            const service = await this.server.getPrimaryService(this.SERVICE_UUID);
            this.txCharacteristic = await service.getCharacteristic(this.TX_CHARACTERISTIC_UUID);
            this.rxCharacteristic = await service.getCharacteristic(this.RX_CHARACTERISTIC_UUID);
            await this.rxCharacteristic.startNotifications();

            this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.notificationHandler);

            return this.device.id || this.device.name; // Return device ID or name
        } catch (error) {
            console.error("Connection failed:", error);
            // Clean up listeners if connection fails partway
            if (this.device) {
                this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
            }
            if (this.rxCharacteristic) {
                // Attempt to stop notifications if started, though this might also fail if device is gone
                try {
                    await this.rxCharacteristic.stopNotifications();
                } catch (stopNotificationError) {
                    // console.warn("Could not stop notifications on failed connect:", stopNotificationError);
                }
                this.rxCharacteristic.removeEventListener('characteristicvaluechanged', this.notificationHandler);
            }
            throw error;
        }
    }

    /**
     * Disconnects from the device.
     */
    public async disconnect() {
        if (this.device && this.device.gatt?.connected) {
            await this.device.gatt.disconnect();
        }
        // The event listener 'gattserverdisconnected' will call handleDisconnect
    }

    /**
     *
     * @returns `true` if the device is connected. `false` otherwise.
     */
    public isConnected(): boolean {
        return this.device !== undefined && this.device.gatt !== undefined && this.device.gatt.connected;
    }

    // MTU size isn't directly queryable in Web Bluetooth.
    // Writes are often limited to around 512 bytes for the ATT_MTU,
    // but the actual characteristic write limit might be smaller.
    // For characteristic.writeValue, it's often ~512 bytes.
    // For characteristic.writeValueWithoutResponse, it's often MTU - 3 (e.g. 20 bytes for default MTU).
    // You'll need to test this with your specific device.
    // Let's assume a conservative value or make it configurable if necessary.
    public getMaxPayload(isLua: boolean): number {
        // This is a rough estimate. The actual limit depends on the negotiated MTU.
        // The Web Bluetooth API doesn't expose MTU directly.
        // Writing larger values might work as the browser/OS handles fragmentation.
        // Typical max ATT_MTU is 517, so data part is 512.
        // For writes with response, the limit is often the full 512.
        const estimatedMaxWrite = 500; // Conservative estimate
        return isLua ? estimatedMaxWrite - 3 : estimatedMaxWrite - 4; // Matching Python logic for overhead
    }


    private async transmit(data: ArrayBuffer, showMe = false) {
        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        if (data.byteLength > 512) { // A common practical limit for a single write
            console.warn("Payload length is large, browser/OS will handle fragmentation if supported.");
        }
        if (showMe) {
            console.log("Transmitting (hex):", Array.from(new Uint8Array(data)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
        await this.txCharacteristic.writeValueWithResponse(data); // Or writeValueWithoutResponse
    }

    /**
     *  Sends a Lua string to the device. The string length must be less than or
     *  equal to `max_lua_payload()`.
     *
     * @param str the Lua string to execute on Frame
     * @param showMe If `show_me=True`, the exact bytes send to the device will be printed.
     * @param awaitPrint If `await_print=True`, the function will block until a Lua print() occurs, or a timeout.
     * @param timeout in ms
     * @returns
     */
    public async sendLua(str: string, showMe = false, awaitPrint = false, timeout = 5000): Promise<string | void> {
        const encodedString = new TextEncoder().encode(str); // Returns Uint8Array, which is an ArrayBufferView
        if (encodedString.buffer.byteLength > this.getMaxPayload(true)) {
             throw new Error("Lua string payload is too large.");
        }

        if (awaitPrint) {
            this.awaitingPrintResponse = true;
            this.printResponsePromise = new Promise((resolve, reject) => {
                this.printResolve = resolve;
                setTimeout(() => {
                    if (this.awaitingPrintResponse) {
                        this.awaitingPrintResponse = false;
                        reject(new Error("Device didn't respond with a print within timeout."));
                    }
                }, timeout);
            });
        }

        await this.transmit(encodedString.buffer, showMe);

        if (awaitPrint) {
            return this.printResponsePromise;
        }
    }

    /**
     *  Sends raw data to the device. The payload length must be less than or
     *  equal to `max_data_payload()`.
     *
     *  If `await_data=True`, the function will block until a data response
     *  occurs, or a timeout.
     *
     *  If `show_me=True`, the exact bytes send to the device will be printed.
     * @param data
     * @param showMe
     * @param awaitData
     * @param timeout in ms
     * @returns
     */
    public async sendData(data: ArrayBuffer, showMe = false, awaitData = false, timeout = 5000): Promise<ArrayBuffer | void> {
        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        if (data.byteLength > this.getMaxPayload(false)) { // Python uses max_data_payload which is mtu - 4
            throw new Error("Data payload is too large for a single packet.");
        }

        const prefix = new Uint8Array([1]);
        const combinedData = new Uint8Array(prefix.length + data.byteLength);
        combinedData.set(prefix, 0);
        combinedData.set(new Uint8Array(data), prefix.length);

        if (awaitData) {
            this.awaitingDataResponse = true;
            this.dataResponsePromise = new Promise((resolve, reject) => {
                this.dataResolve = resolve;
                setTimeout(() => {
                    if (this.awaitingDataResponse) {
                        this.awaitingDataResponse = false;
                        reject(new Error("Device didn't respond with data within timeout."));
                    }
                }, timeout);
            });
        }

        await this.transmit(combinedData.buffer, showMe);

        if (awaitData) {
            return this.dataResponsePromise;
        }
    }

    /**
     * Sends a reset signal to the device which will reset the Lua virtual machine.
     *
     * @param showMe If `show_me=true`, the exact bytes send to the device will be printed.
     */
    public async sendResetSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x04]);
        await this.transmit(signal.buffer, showMe);
        // Give it a moment after the Lua VM reset
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    /**
     * Sends a break signal to the device which will break any currently executing Lua script.
     *
     * @param showMe If `show_me=true`, the exact bytes send to the device will be printed.
     */
    public async sendBreakSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x03]);
        await this.transmit(signal.buffer, showMe);
        // Give it a moment after the break
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    /**
     * Uploads a string as frame_file_path. If the file exists, it will be overwritten.
     *
     * @param content The string content to upload
     * @param frameFilePath Target file path on Frame
     */
    public async uploadFileFromString(content: string, frameFilePath = "main.lua"): Promise<void> {
        // Escape special characters
        let escapedContent = content.replace(/\r/g, "")
                                  .replace(/\\/g, "\\\\")
                                  .replace(/\n/g, "\\n")
                                  .replace(/\t/g, "\\t")
                                  .replace(/'/g, "\\'")
                                  .replace(/"/g, '\\"');

        // Open the file on the frame
        const openResponse = await this.sendLua(`f=frame.file.open('${frameFilePath}','w');print(1)`, false, true);
        if (openResponse !== "1") {
            throw new Error(`Failed to open file ${frameFilePath} on device. Response: ${openResponse}`);
        }


        // Calculate chunk size accounting for the Lua command overhead
        // f:write("CHUNK_HERE");print(1) -> 22 characters overhead approx.
        // Lua command: f:write("");print(1) is 20 chars for the command itself.
        // Plus quotes for the string: 2 chars. So 22.
        const luaCommandOverhead = 22;
        const maxChunkSize = this.getMaxPayload(true) - luaCommandOverhead;

        if (maxChunkSize <= 0) {
            throw new Error("Max payload size too small for file upload operations.");
        }

        let i = 0;
        while (i < escapedContent.length) {
            let currentChunkSize = Math.min(maxChunkSize, escapedContent.length - i);
            let chunk = escapedContent.substring(i, i + currentChunkSize);

            // Check for split escape sequences at the end of the chunk.
            // If the chunk ends with an odd number of backslashes, the last one is escaping the quote.
            // We need to reduce the chunk size to avoid sending an incomplete escape sequence.
            // Example: content "...\abc\\", chunk ends as "...\abc\", quote would be \"
            // If chunk ends as "...\abc\\", quote would be \\" (escaped slash, then quote)
            // This is a simplified check. The python version is more robust.
            // For a simple scenario, if a chunk ends with '\', it might break the Lua string.
            // A better approach for web might be to Hex encode the string chunks if issues persist.
            if (chunk.endsWith("\\")) {
                 // Count trailing backslashes
                let trailingSlashes = 0;
                for (let k = chunk.length - 1; k >= 0; k--) {
                    if (chunk[k] === '\\') {
                        trailingSlashes++;
                    } else {
                        break;
                    }
                }
                // If odd number of trailing slashes, the last one would escape the closing quote of Lua string
                if (trailingSlashes % 2 !== 0) {
                    if (currentChunkSize > 1) { // Ensure we can reduce
                       currentChunkSize--;
                       chunk = escapedContent.substring(i, i + currentChunkSize);
                    } else {
                        // This scenario (single backslash chunk that cannot be reduced) is problematic
                        // and might require a more complex solution like base64 encoding the chunk.
                        // For now, we'll throw an error or log a warning.
                        throw new Error("Cannot safely chunk content due to isolated escape character at chunk boundary.");
                    }
                }
            }


            const writeResponse = await this.sendLua(`f:write("${chunk}");print(1)`, false, true);
            if (writeResponse !== "1") {
                throw new Error(`Failed to write chunk to ${frameFilePath}. Response: ${writeResponse}`);
            }
            i += currentChunkSize;
        }

        // Close the file
        const closeResponse = await this.sendLua("f:close();print(nil)", false, true);
        // print(nil) results in an empty string or specific device response for nil.
        // The python code expects "None" or "" or specific response.
        // For WebBluetooth, an empty string is common for `print(nil)`.
        // We'll consider an empty string or a specific "nil" string as success.
        if (closeResponse !== "" && closeResponse !== "nil" && closeResponse !== null && typeof closeResponse !== 'undefined') {
             // console.warn(`Unexpected response when closing file: '${closeResponse}'`);
             // Depending on device, this might not be an error. If issues, check device behavior for print(nil).
        }
    }

    /**
     * Uploads content (as a string) to the specified file path on the Frame.
     * If the target file exists, it will be overwritten.
     * Note: In a web environment, file content must be read by the application
     * (e.g., from a File input or fetched) before calling this method.
     *
     * @param fileContent The string content of the file to upload.
     * @param frameFilePath Target file path on the frame (e.g., "main.lua").
     */
    public async uploadFile(fileContent: string, frameFilePath = "main.lua"): Promise<void> {
        // In a browser context, we can't read from a local_file_path directly
        // like in Python. The content must be provided.
        await this.uploadFileFromString(fileContent, frameFilePath);
    }

    /**
     *  Send a large payload in chunks determined by BLE MTU size.
     *
     *  Raises:
     *      Error: If msg_code is not in range 0-255 or payload size exceeds 65535
     *
     *  Note:
     *      First packet format: [msg_code(1), size_high(1), size_low(1), data(...)]
     *      Other packets format: [msg_code(1), data(...)]
     *
     * @param msgCode Message type identifier (0-255)
     * @param payload Data to be sent
     * @param showMe If true, the exact bytes send to the device will be printed
     */
    public async sendMessage(msgCode: number, payload: ArrayBuffer, showMe = false): Promise<void> {
        const HEADER_SIZE = 3; // msg_code(1), size_high(1), size_low(1)
        const SUBSEQUENT_HEADER_SIZE = 1; // just msg_code
        const MAX_TOTAL_SIZE = 65535; // 2^16 - 1

        if (msgCode < 0 || msgCode > 255) {
            throw new Error(`Message code must be 0-255, got ${msgCode}`);
        }

        const totalSize = payload.byteLength;
        if (totalSize > MAX_TOTAL_SIZE) {
            throw new Error(`Payload size ${totalSize} exceeds maximum ${MAX_TOTAL_SIZE} bytes`);
        }

        const maxDataPayload = this.getMaxPayload(false); // Corresponds to python's self.max_data_payload()

        const maxFirstChunkDataSize = maxDataPayload - HEADER_SIZE;
        const maxSubsequentChunkDataSize = maxDataPayload - SUBSEQUENT_HEADER_SIZE;

        if (maxFirstChunkDataSize <=0 || maxSubsequentChunkDataSize <=0) {
            throw new Error("Max payload size too small for message sending protocol.");
        }

        let sentBytes = 0;
        const payloadBytes = new Uint8Array(payload);

        // Send first chunk
        const firstChunkDataSize = Math.min(maxFirstChunkDataSize, totalSize);
        const firstPacket = new Uint8Array(HEADER_SIZE + firstChunkDataSize);
        firstPacket[0] = msgCode;
        firstPacket[1] = totalSize >> 8;    // size_high
        firstPacket[2] = totalSize & 0xFF;  // size_low
        firstPacket.set(payloadBytes.subarray(0, firstChunkDataSize), HEADER_SIZE);

        await this.sendData(firstPacket.buffer.slice(firstPacket.byteOffset, firstPacket.byteOffset + firstPacket.byteLength), showMe, true); // Slice to get correct ArrayBuffer
        sentBytes += firstChunkDataSize;

        // Send remaining chunks
        while (sentBytes < totalSize) {
            const remaining = totalSize - sentBytes;
            const currentChunkDataSize = Math.min(maxSubsequentChunkDataSize, remaining);
            const subsequentPacket = new Uint8Array(SUBSEQUENT_HEADER_SIZE + currentChunkDataSize);
            subsequentPacket[0] = msgCode;
            subsequentPacket.set(payloadBytes.subarray(sentBytes, sentBytes + currentChunkDataSize), SUBSEQUENT_HEADER_SIZE);

            await this.sendData(subsequentPacket.buffer.slice(subsequentPacket.byteOffset, subsequentPacket.byteOffset + subsequentPacket.byteLength), showMe, true); // Slice to get correct ArrayBuffer
            sentBytes += currentChunkDataSize;
        }
    }
}
