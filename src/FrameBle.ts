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
    // Updated promise and resolve types for data responses
    private dataResponsePromise?: Promise<Uint8Array>;
    private dataResolve?: (value: Uint8Array) => void;

    // Updated handler types
    private onDataResponse?: (data: Uint8Array) => void | Promise<void>;
    private onPrintResponse?: (data: string) => void | Promise<void>;
    private onDisconnectHandler?: () => void;

    constructor() {}

    /**
     * Sets or updates the handler for asynchronous data responses from the device.
     * @param handler The function to call when data (as Uint8Array) is received.
     * Pass undefined to remove the current handler.
     */
    public setDataResponseHandler(handler: ((data: Uint8Array) => void | Promise<void>) | undefined): void {
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
        if (!value || value.buffer.byteLength === 0) return;

        // The first byte of the raw characteristic value determines the type of message.
        // 0x01 indicates a data response. Other values (or no prefix) indicate a print response.
        // Note: Some devices might send print strings without a specific prefix byte if the data
        // is purely string data and not conforming to a more complex protocol on the same characteristic.
        // Here, we assume if it's not explicitly a data packet (0x01), it's a print string.

        if (value.byteLength > 0 && value.getUint8(0) === 1) { // Data response
            // Create a Uint8Array view of the data payload (from byte 1 to the end).
            // This avoids copying the underlying ArrayBuffer.
            const actualData = new Uint8Array(value.buffer, value.byteOffset + 1, value.byteLength - 1);

            if (this.awaitingDataResponse && this.dataResolve) {
                this.awaitingDataResponse = false;
                this.dataResolve(actualData); // Resolve with Uint8Array
            }
            if (this.onDataResponse) {
                const result = this.onDataResponse(actualData); // Pass Uint8Array
                if (result instanceof Promise) {
                    result.catch(console.error);
                }
            }
        } else { // Print response (string)
            const decodedString = new TextDecoder().decode(value); // DataView is decodable
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
    Connects to the first Frame device discovered.
    */
    public async connect(
        options: {
            name?: string;
            namePrefix?: string;
        } = {}
    ): Promise<string | undefined> {
        if (!navigator.bluetooth) {
            throw new Error("Web Bluetooth API not available.");
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

            await this.sendBreakSignal(false);

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
                    this.device.gatt.disconnect();
                }
            }
            if (this.rxCharacteristic) {
                try {
                    if (this.device?.gatt?.connected) {
                         await this.rxCharacteristic.stopNotifications();
                    }
                } catch (stopNotificationError) {
                    // console.warn("Could not stop notifications on failed connect:", stopNotificationError);
                }
                this.rxCharacteristic.removeEventListener('characteristicvaluechanged', this.notificationHandler);
            }
            this.device = undefined;
            this.server = undefined;
            this.txCharacteristic = undefined;
            this.rxCharacteristic = undefined;
            throw error;
        }
    }

    public async disconnect() {
        if (this.device && this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        } else {
            this.handleDisconnect();
        }
    }

    public isConnected(): boolean {
        return !!(this.device && this.device.gatt && this.device.gatt.connected);
    }

    public getMaxPayload(isLua: boolean): number {
        return isLua ? this.maxPayload : this.maxPayload - 1;
    }

    private async transmit(data: Uint8Array, showMe = false) {
        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        if (data.byteLength > this.maxPayload) {
            throw new Error(`Payload length: ${data.byteLength} exceeds maximum BLE packet size: ${this.maxPayload}`);
        }
        if (showMe) {
            console.log("Transmitting (hex):", Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        }
        await this.txCharacteristic.writeValueWithResponse(data);
    }

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
        if (encodedString.byteLength > this.getMaxPayload(true)) {
             throw new Error(`Lua string payload (${encodedString.byteLength} bytes) is too large for max Lua payload (${this.getMaxPayload(true)} bytes).`);
        }

        if (awaitPrint) {
            if (this.printTimeoutId) clearTimeout(this.printTimeoutId);
            this.awaitingPrintResponse = true;
            this.printResponsePromise = new Promise<string>((resolve, reject) => {
                this.printResolve = resolve;
                this.printTimeoutId = setTimeout(() => {
                    if (this.awaitingPrintResponse) {
                        this.awaitingPrintResponse = false;
                        this.printResolve = undefined;
                        reject(new Error(`Device didn't respond with a print within ${timeout}ms.`));
                    }
                }, timeout);
            }).finally(() => {
                if (this.printTimeoutId) {
                    clearTimeout(this.printTimeoutId);
                    this.printTimeoutId = undefined;
                }
            });
        }

        await this.transmit(encodedString, showMe);
        if (awaitPrint) return this.printResponsePromise;
    }

    /**
     * Sends raw data to the device. The data is prefixed with 0x01.
     * @param data The raw application payload to send as Uint8Array.
     * @param options Configuration for sending data.
     * @returns A promise that resolves with the Uint8Array data response if awaitData is true, or void otherwise.
     */
    public async sendData(
        data: Uint8Array, // This is the application payload
        options: {
            showMe?: boolean;
            awaitData?: boolean;
            timeout?: number;
        } = {}
    ): Promise<Uint8Array | void> { // Updated return type
        const { showMe = false, awaitData = false, timeout = 5000 } = options;

        if (!this.txCharacteristic) {
            throw new Error("Not connected or TX characteristic not available.");
        }
        if (data.byteLength > this.getMaxPayload(false)) {
            throw new Error(`Data payload (${data.byteLength} bytes) is too large for max data payload (${this.getMaxPayload(false)} bytes).`);
        }

        const prefix = new Uint8Array([1]); // 0x01 prefix for raw data
        const combinedData = new Uint8Array(prefix.length + data.byteLength);
        combinedData.set(prefix, 0);
        combinedData.set(data, prefix.length);

        let dataTimeoutId: NodeJS.Timeout | undefined;

        if (awaitData) {
            this.awaitingDataResponse = true;
            // Ensure the promise type matches the updated dataResolve type
            this.dataResponsePromise = new Promise<Uint8Array>((resolve, reject) => {
                this.dataResolve = resolve; // dataResolve expects Uint8Array
                dataTimeoutId = setTimeout(() => {
                    if (this.awaitingDataResponse) {
                        this.awaitingDataResponse = false;
                        this.dataResolve = undefined;
                        reject(new Error(`Device didn't respond with data within ${timeout}ms.`));
                    }
                }, timeout);
            }).finally(() => {
                if (dataTimeoutId) clearTimeout(dataTimeoutId);
            });
        }

        await this.transmit(combinedData, showMe);
        if (awaitData) return this.dataResponsePromise; // Returns Promise<Uint8Array>
    }

    public async sendResetSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x04]);
        await this.transmit(signal, showMe);
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    public async sendBreakSignal(showMe = false): Promise<void> {
        const signal = new Uint8Array([0x03]);
        await this.transmit(signal, showMe);
        await new Promise(resolve => setTimeout(resolve, 200));
    }

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

        const luaCommandOverhead = `f:write("");print(1)`.length;
        const maxChunkSize = this.getMaxPayload(true) - luaCommandOverhead;

        if (maxChunkSize <= 0) {
            throw new Error("Max payload size too small for file upload operations.");
        }

        let i = 0;
        while (i < escapedContent.length) {
            let currentChunkSize = Math.min(maxChunkSize, escapedContent.length - i);
            let chunk = escapedContent.substring(i, i + currentChunkSize);

            while (chunk.endsWith("\\")) {
                let trailingSlashes = 0;
                for (let k = chunk.length - 1; k >= 0; k--) {
                    if (chunk[k] === '\\') trailingSlashes++; else break;
                }
                if (trailingSlashes % 2 !== 0) {
                    if (currentChunkSize > 1) {
                        currentChunkSize--;
                        chunk = escapedContent.substring(i, i + currentChunkSize);
                    } else {
                        await this.sendLua("f:close();print(nil)", {awaitPrint: true});
                        throw new Error("Cannot safely chunk content due to isolated escape character at chunk boundary.");
                    }
                } else {
                    break;
                }
            }

            const writeResponse = await this.sendLua(`f:write("${chunk}");print(1)`, {awaitPrint: true});
            if (writeResponse !== "1") {
                 await this.sendLua("f:close();print(nil)", {awaitPrint: true});
                throw new Error(`Failed to write chunk to ${frameFilePath}. Response: ${writeResponse}`);
            }
            i += currentChunkSize;
        }
        await this.sendLua("f:close();print(nil)", {awaitPrint: true});
    }

    public async uploadFile(fileContent: string, frameFilePath = "main.lua"): Promise<void> {
        await this.uploadFileFromString(fileContent, frameFilePath);
    }

    public async sendMessage(msgCode: number, payload: Uint8Array, showMe = false): Promise<void> {
        const HEADER_SIZE = 2; // size_high(1), size_low(1)
        const MAX_TOTAL_PAYLOAD_SIZE = 65535;

        if (msgCode < 0 || msgCode > 255) {
            throw new Error(`Message code must be 0-255, got ${msgCode}`);
        }
        const totalPayloadSize = payload.byteLength;
        if (totalPayloadSize > MAX_TOTAL_PAYLOAD_SIZE) {
            throw new Error(`Payload size ${totalPayloadSize} exceeds maximum ${MAX_TOTAL_PAYLOAD_SIZE} bytes`);
        }

        const maxDataPayloadForSend = this.getMaxPayload(false);
        const maxFirstChunkDataSize = maxDataPayloadForSend - 1 - HEADER_SIZE;
        const maxSubsequentChunkDataSize = maxDataPayloadForSend - 1;

        if (maxFirstChunkDataSize <=0 || maxSubsequentChunkDataSize <=0) {
            throw new Error("Max payload size too small for message sending protocol.");
        }

        let sentBytes = 0;
        const firstChunkActualDataSize = Math.min(maxFirstChunkDataSize, totalPayloadSize);
        const firstPacketDataForSendData = new Uint8Array(1 + HEADER_SIZE + firstChunkActualDataSize);
        firstPacketDataForSendData[0] = msgCode;
        firstPacketDataForSendData[1] = totalPayloadSize >> 8;
        firstPacketDataForSendData[2] = totalPayloadSize & 0xFF;
        firstPacketDataForSendData.set(payload.subarray(0, firstChunkActualDataSize), 1 + HEADER_SIZE);

        await this.sendData(firstPacketDataForSendData, {showMe: showMe, awaitData: true});
        sentBytes += firstChunkActualDataSize;

        while (sentBytes < totalPayloadSize) {
            const remaining = totalPayloadSize - sentBytes;
            const currentChunkActualDataSize = Math.min(maxSubsequentChunkDataSize, remaining);
            const subsequentPacketDataForSendData = new Uint8Array(1 + currentChunkActualDataSize);
            subsequentPacketDataForSendData[0] = msgCode;
            subsequentPacketDataForSendData.set(payload.subarray(sentBytes, sentBytes + currentChunkActualDataSize), 1);

            await this.sendData(subsequentPacketDataForSendData, {showMe: showMe, awaitData: true});
            sentBytes += currentChunkActualDataSize;
        }
    }
}
