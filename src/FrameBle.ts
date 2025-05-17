/**
 * Class for managing a connection to and transferring data to and from
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

    private maxPayload = 60; // will be set after connection
    private awaitingPrintResponse = false;
    private awaitingDataResponse = false;
    private printTimeoutId?: NodeJS.Timeout;
    private printResponsePromise?: Promise<string>;
    private printResolve?: (value: string) => void;
    private dataResponsePromise?: Promise<DataView<ArrayBufferLike>>;
    private dataResolve?: (value: DataView<ArrayBufferLike>) => void;

    // Handler properties remain private
    private onDataResponse?: (data: DataView<ArrayBufferLike>) => void | Promise<void>;
    private onPrintResponse?: (data: string) => void | Promise<void>;
    private onDisconnectHandler?: () => void;

    constructor() {}

    /**
     * Sets or updates the handler for asynchronous data responses from the device.
     * @param handler The function to call when data is received.
     * Pass undefined to remove the current handler.
     */
    public setDataResponseHandler(handler: ((data: DataView<ArrayBufferLike>) => void | Promise<void>) | undefined): void {
        this.onDataResponse = handler;
    }

    /**
     * Sets or updates the handler for asynchronous print (string) responses from the device.
     * @param handler The function to call when a print string is received.
     * Pass undefined to remove the current handler.
     */
    public setPrintResponseHandler(handler: ((data: string) => void | Promise<void>) | undefined): void {
        this.onPrintResponse = handler;
    }

    /**
     * Sets or updates the handler for disconnection events.
     * @param handler The function to call when the device disconnects.
     * Pass undefined to remove the current handler.
     */
    public setDisconnectHandler(handler: (() => void) | undefined): void {
        this.onDisconnectHandler = handler;
    }


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

        if (value.getUint8(0) === 1) { // Data response
            const actualData = new DataView(value.buffer, value.byteOffset + 1, value.byteLength - 1);
            if (this.awaitingDataResponse && this.dataResolve) {
                this.awaitingDataResponse = false;
                this.dataResolve(actualData);
            }
            // Use the potentially updated handler
            if (this.onDataResponse) {
                const result = this.onDataResponse(actualData);
                if (result instanceof Promise) {
                    result.catch(console.error);
                }
            }
        } else { // Print response (string)
            const decodedString = new TextDecoder().decode(value);
            if (this.awaitingPrintResponse && this.printResolve) {
                this.awaitingPrintResponse = false;
                this.printResolve(decodedString);
            }
            // Use the potentially updated handler
            if (this.onPrintResponse) {
                const result = this.onPrintResponse(decodedString);
                if (result instanceof Promise) {
                    result.catch(console.error);
                }
            }
        }
    }

    /**
    Connects to the first Frame device discovered.
    Handlers can be provided here or set dynamically using setter methods.
    */
    public async connect(
        options: {
            name?: string;
            namePrefix?: string;
            printResponseHandler?: (data: string) => void | Promise<void>;
            dataResponseHandler?: (data: DataView<ArrayBufferLike>) => void | Promise<void>;
            disconnectHandler?: () => void;
        } = {}
    ): Promise<string | undefined> {
        if (!navigator.bluetooth) {
            throw new Error("Web Bluetooth API not available.");
        }

        // Set handlers if provided in options, otherwise they might have been set by setters
        if (options.printResponseHandler) {
            this.onPrintResponse = options.printResponseHandler;
        }
        if (options.dataResponseHandler) {
            this.onDataResponse = options.dataResponseHandler;
        }
        if (options.disconnectHandler) {
            this.onDisconnectHandler = options.disconnectHandler;
        }

        const baseFilter: BluetoothLEScanFilter = options.name
            ? { services: [this.SERVICE_UUID], name: options.name }
            : options.namePrefix
                ? { services: [this.SERVICE_UUID], namePrefix: options.namePrefix }
                : { services: [this.SERVICE_UUID] };

        const deviceOptions: RequestDeviceOptions = {
            filters: [baseFilter],
            optionalServices: [this.SERVICE_UUID],
        };

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

            // Send a break signal to clear any existing Lua state that might interfere with MTU query
            // This is a common practice before critical operations like MTU negotiation
            // to ensure the device's REPL is in a known state.
            await this.sendBreakSignal(false); // showMe = false

            // Query MTU size
            const mtuString = await this.sendLua("print(frame.bluetooth.max_length())", {awaitPrint: true});
            if (mtuString === undefined || mtuString === null) {
                throw new Error("Failed to get MTU size from device.");
            } else {
                const mtu = parseInt(mtuString);
                if (isNaN(mtu) || mtu <= 0) {
                    throw new Error(`Invalid MTU size received: '${mtuString}'`);
                } else {
                    this.maxPayload = mtu;
                }
            }

            return this.device.id || this.device.name || "Unknown Device";
        } catch (error) {
            console.error("Connection failed:", error);
            if (this.device) {
                this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
                if (this.device.gatt?.connected) {
                    this.device.gatt.disconnect(); // Attempt to disconnect if partially connected
                }
            }
            if (this.rxCharacteristic) {
                try {
                    if (this.device?.gatt?.connected) { // Only if still connected
                         await this.rxCharacteristic.stopNotifications();
                    }
                } catch (stopNotificationError) {
                    // console.warn("Could not stop notifications on failed connect:", stopNotificationError);
                }
                this.rxCharacteristic.removeEventListener('characteristicvaluechanged', this.notificationHandler);
            }
            // Reset internal state
            this.device = undefined;
            this.server = undefined;
            this.txCharacteristic = undefined;
            this.rxCharacteristic = undefined;
            throw error;
        }
    }

    /**
     * Disconnects from the device.
     */
    public async disconnect() {
        if (this.device && this.device.gatt?.connected) {
            this.device.gatt.disconnect();
            // The 'gattserverdisconnected' event listener will call handleDisconnect
            // and perform further cleanup.
        } else {
            // If not connected but state might be inconsistent, ensure cleanup
            this.handleDisconnect();
        }
    }

    /**
     * @returns `true` if the device is connected. `false` otherwise.
     */
    public isConnected(): boolean {
        return this.device !== undefined && this.device.gatt !== undefined && this.device.gatt.connected;
    }

    /**
     * Returns the maximum payload size for Lua strings or raw data.
     * @param isLua If true, returns the max payload size for Lua strings. Otherwise, for raw data.
     * @returns Maximum payload size in bytes
     */
    public getMaxPayload(isLua: boolean): number {
        // For raw data, 1 byte is used for the prefix 0x01.
        return isLua ? this.maxPayload : this.maxPayload - 1;
    }

    private async transmit(data: Uint8Array, showMe = false) {
        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        // Max payload for transmit should be the raw MTU (this.maxPayload)
        // as getMaxPayload(true) or getMaxPayload(false) is about what *we* can fit *into* a Lua string or data packet
        // not the raw characteristic write limit. The BLE stack handles fragmentation if data > MTU,
        // but we are trying to send application-level packets that fit within one BLE packet.
        if (data.byteLength > this.maxPayload) { // Check against raw maxPayload
            throw new Error(`Payload length: ${data.byteLength} exceeds maximum BLE packet size: ${this.maxPayload}`);
        }
        if (showMe) {
            console.log("Transmitting (hex):", Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
        await this.txCharacteristic.writeValueWithResponse(data);
    }

    /**
     * Sends a Lua string to the device.
     * @param str the Lua string to execute on Frame
     * @param options Configuration for sending the Lua string.
     * @returns A promise that resolves with the print response if awaitPrint is true, or void otherwise.
     */
    public async sendLua(
        str: string,
        options: {
            showMe?: boolean;
            awaitPrint?: boolean;
            timeout?: number;
        } = {}
    ): Promise<string | void> {
        const { showMe = false, awaitPrint = false, timeout = 5000 } = options;

        const encodedString = new TextEncoder().encode(str);
        if (encodedString.byteLength > this.getMaxPayload(true)) { // getMaxPayload(true) is correct here
             throw new Error(`Lua string payload (${encodedString.byteLength} bytes) is too large for max Lua payload (${this.getMaxPayload(true)} bytes).`);
        }

        if (awaitPrint) {
            if (this.printTimeoutId) {
                clearTimeout(this.printTimeoutId);
            }

            this.awaitingPrintResponse = true;
            this.printResponsePromise = new Promise<string>((resolve, reject) => {
                this.printResolve = resolve; // Store resolve to be called by notificationHandler
                this.printTimeoutId = setTimeout(() => {
                    if (this.awaitingPrintResponse) { // Check if still awaiting
                        this.awaitingPrintResponse = false;
                        this.printResolve = undefined; // Clear resolver
                        reject(new Error(`Device didn't respond with a print within ${timeout}ms.`));
                    }
                }, timeout);
            }).finally(() => { // Cleanup timeout regardless of promise outcome
                if (this.printTimeoutId) {
                    clearTimeout(this.printTimeoutId);
                    this.printTimeoutId = undefined;
                }
            });
        }

        await this.transmit(encodedString, showMe);

        if (awaitPrint) {
            return this.printResponsePromise;
        }
    }

    /**
     * Sends raw data to the device.
     * @param data The raw data to send as Uint8Array.
     * @param options Configuration for sending data.
     * @returns A promise that resolves with the data response if awaitData is true, or void otherwise.
     */
    public async sendData(
        data: Uint8Array, // This data should NOT include the 0x01 prefix. sendData adds it.
        options: {
            showMe?: boolean;
            awaitData?: boolean;
            timeout?: number;
        } = {}
    ): Promise<DataView<ArrayBufferLike> | void> {
        const { showMe = false, awaitData = false, timeout = 5000 } = options;

        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        // The 'data' parameter is the payload. We add 1 byte for the prefix.
        if (data.byteLength > this.getMaxPayload(false)) { // getMaxPayload(false) is correct
            throw new Error(`Data payload (${data.byteLength} bytes) is too large for max data payload (${this.getMaxPayload(false)} bytes).`);
        }

        const prefix = new Uint8Array([1]); // 0x01 prefix for raw data
        const combinedData = new Uint8Array(prefix.length + data.byteLength);
        combinedData.set(prefix, 0);
        combinedData.set(data, prefix.length); // data is already a Uint8Array

        let dataTimeoutId: NodeJS.Timeout | undefined;

        if (awaitData) {
            this.awaitingDataResponse = true;
            this.dataResponsePromise = new Promise<DataView<ArrayBufferLike>>((resolve, reject) => {
                this.dataResolve = resolve;
                dataTimeoutId = setTimeout(() => {
                    if (this.awaitingDataResponse) {
                        this.awaitingDataResponse = false;
                        this.dataResolve = undefined;
                        reject(new Error(`Device didn't respond with data within ${timeout}ms.`));
                    }
                }, timeout);
            }).finally(() => {
                if (dataTimeoutId) {
                    clearTimeout(dataTimeoutId);
                }
            });
        }

        await this.transmit(combinedData, showMe);

        if (awaitData) {
            return this.dataResponsePromise;
        }
    }

    /**
     * Sends a reset signal (0x04) to the device.
     * @param showMe If true, logs the transmitted bytes.
     */
    public async sendResetSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x04]);
        await this.transmit(signal, showMe);
        await new Promise(resolve => setTimeout(resolve, 200)); // Allow time for reset
    }

    /**
     * Sends a break signal (0x03) to the device.
     * @param showMe If true, logs the transmitted bytes.
     */
    public async sendBreakSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x03]);
        await this.transmit(signal, showMe);
        await new Promise(resolve => setTimeout(resolve, 200)); // Allow time for break
    }

    /**
     * Uploads a string as a file to the specified path on Frame.
     * @param content The string content to upload.
     * @param frameFilePath Target file path on Frame (e.g., "main.lua").
     */
    public async uploadFileFromString(content: string, frameFilePath = "main.lua"): Promise<void> {
        let escapedContent = content.replace(/\r/g, "")
                                  .replace(/\\/g, "\\\\")
                                  .replace(/\n/g, "\\n")
                                  .replace(/\t/g, "\\t")
                                  .replace(/'/g, "\\'")
                                  .replace(/"/g, '\\"');

        const openResponse = await this.sendLua(`f=frame.file.open('${frameFilePath}','w');print(1)`, {awaitPrint: true});
        if (openResponse !== "1") {
            throw new Error(`Failed to open file ${frameFilePath} on device. Response: ${openResponse}`);
        }

        const luaCommandOverhead = `f:write("");print(1)`.length; // Approx. 20 + 2 for quotes
        const maxChunkSize = this.getMaxPayload(true) - luaCommandOverhead;

        if (maxChunkSize <= 0) {
            throw new Error("Max payload size too small for file upload operations.");
        }

        let i = 0;
        while (i < escapedContent.length) {
            let currentChunkSize = Math.min(maxChunkSize, escapedContent.length - i);
            let chunk = escapedContent.substring(i, i + currentChunkSize);

            // Robust handling for escape characters at chunk boundaries
            while (chunk.endsWith("\\")) {
                let trailingSlashes = 0;
                for (let k = chunk.length - 1; k >= 0; k--) {
                    if (chunk[k] === '\\') trailingSlashes++;
                    else break;
                }
                if (trailingSlashes % 2 !== 0) { // Odd number of trailing slashes means last one escapes quote
                    if (currentChunkSize > 1) {
                        currentChunkSize--;
                        chunk = escapedContent.substring(i, i + currentChunkSize);
                    } else {
                        // This chunk is just a single '\' or ends in an odd number of '\' and cannot be reduced.
                        // This is a problematic case. Consider base64 encoding or other strategies if this occurs.
                        // For now, we throw an error as it would break the Lua string.
                        await this.sendLua("f:close();print(nil)", {awaitPrint: true}); // Attempt to close file
                        throw new Error("Cannot safely chunk content due to isolated escape character at chunk boundary. File upload aborted.");
                    }
                } else {
                    break; // Even number of slashes, or no trailing slash, is fine.
                }
            }


            const writeResponse = await this.sendLua(`f:write("${chunk}");print(1)`, {awaitPrint: true});
            if (writeResponse !== "1") {
                 await this.sendLua("f:close();print(nil)", {awaitPrint: true}); // Attempt to close file
                throw new Error(`Failed to write chunk to ${frameFilePath}. Response: ${writeResponse}`);
            }
            i += currentChunkSize;
        }

        await this.sendLua("f:close();print(nil)", {awaitPrint: true});
        // Note: print(nil) often results in an empty string or device-specific "nil" response.
        // No strict check on closeResponse as it varies.
    }

    /**
     * Uploads content (as a string) to the specified file path on the Frame.
     * @param fileContent The string content of the file to upload.
     * @param frameFilePath Target file path on the frame (e.g., "main.lua").
     */
    public async uploadFile(fileContent: string, frameFilePath = "main.lua"): Promise<void> {
        await this.uploadFileFromString(fileContent, frameFilePath);
    }

    /**
     * Sends a large payload in chunks.
     * @param msgCode Message type identifier (0-255).
     * @param payload Data to be sent as Uint8Array. This is the pure payload, without msgCode or size.
     * @param showMe If true, logs the transmitted bytes.
     */
    public async sendMessage(msgCode: number, payload: Uint8Array, showMe = false): Promise<void> {
        const HEADER_SIZE = 2; // size_high(1), size_low(1). msgCode is part of the data in sendData.
        const MAX_TOTAL_PAYLOAD_SIZE = 65535; // Max size for the payload itself.

        if (msgCode < 0 || msgCode > 255) {
            throw new Error(`Message code must be 0-255, got ${msgCode}`);
        }

        const totalPayloadSize = payload.byteLength;
        if (totalPayloadSize > MAX_TOTAL_PAYLOAD_SIZE) {
            throw new Error(`Payload size ${totalPayloadSize} exceeds maximum ${MAX_TOTAL_PAYLOAD_SIZE} bytes`);
        }

        // maxDataPayloadForSend is the max size for the *data* part of a sendData call.
        const maxDataPayloadForSend = this.getMaxPayload(false);

        // First packet: [msgCode(1), size_high(1), size_low(1), data_chunk(...)]
        // The data for sendData will be: [msgCode, size_high, size_low, payload_chunk_1]
        // So, the payload_chunk_1 size is maxDataPayloadForSend - 1 (for msgCode) - 2 (for size bytes)
        const maxFirstChunkDataSize = maxDataPayloadForSend - 1 - HEADER_SIZE;

        // Subsequent packets: [msgCode(1), data_chunk(...)]
        // The data for sendData will be: [msgCode, payload_chunk_n]
        // So, the payload_chunk_n size is maxDataPayloadForSend - 1 (for msgCode)
        const maxSubsequentChunkDataSize = maxDataPayloadForSend - 1;

        if (maxFirstChunkDataSize <=0 || maxSubsequentChunkDataSize <=0) {
            throw new Error("Max payload size too small for message sending protocol.");
        }

        let sentBytes = 0;

        // Send first chunk
        const firstChunkActualDataSize = Math.min(maxFirstChunkDataSize, totalPayloadSize);
        // Data to pass to sendData:
        const firstPacketDataForSendData = new Uint8Array(1 + HEADER_SIZE + firstChunkActualDataSize);
        firstPacketDataForSendData[0] = msgCode;
        firstPacketDataForSendData[1] = totalPayloadSize >> 8;    // size_high
        firstPacketDataForSendData[2] = totalPayloadSize & 0xFF;  // size_low
        firstPacketDataForSendData.set(payload.subarray(0, firstChunkActualDataSize), 1 + HEADER_SIZE);

        // sendData will add its own 0x01 prefix. We expect a data response.
        await this.sendData(firstPacketDataForSendData, {showMe: showMe, awaitData: true});
        sentBytes += firstChunkActualDataSize;

        // Send remaining chunks
        while (sentBytes < totalPayloadSize) {
            const remaining = totalPayloadSize - sentBytes;
            const currentChunkActualDataSize = Math.min(maxSubsequentChunkDataSize, remaining);
            // Data to pass to sendData:
            const subsequentPacketDataForSendData = new Uint8Array(1 + currentChunkActualDataSize);
            subsequentPacketDataForSendData[0] = msgCode;
            subsequentPacketDataForSendData.set(payload.subarray(sentBytes, sentBytes + currentChunkActualDataSize), 1);

            await this.sendData(subsequentPacketDataForSendData, {showMe: showMe, awaitData: true});
            sentBytes += currentChunkActualDataSize;
        }
    }
}
