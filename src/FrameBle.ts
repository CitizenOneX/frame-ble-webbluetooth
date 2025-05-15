// src/FrameBle.ts
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

    public async disconnect() {
        if (this.device && this.device.gatt?.connected) {
            await this.device.gatt.disconnect();
        }
        // The event listener 'gattserverdisconnected' will call handleDisconnect
    }

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
    // ... (sendData, sendResetSignal, sendBreakSignal, uploadFileFromString, uploadFile, sendMessage)
}