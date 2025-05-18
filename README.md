# frame-ble

Low-level library for Bluetooth LE connection to [Brilliant Labs Frame](https://brilliant.xyz/)

[Frame SDK documentation](https://docs.brilliant.xyz/frame/frame-sdk/).

[GitHub](https://github.com/CitizenOneX/frame-ble-webbluetooth/).

[Live Examples](https://citizenonex.github.io/frame-ble-webbluetooth/).

## Installation

```bash
npm install frame-ble
```

## Usage

```javascript
import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  const deviceId = await frameBle.connect();

  frameBle.setPrintResponseHandler(console.log);

  // Send a break signal to the Frame in case it is in a loop
  await frameBle.sendBreakSignal({showMe: true});

  // Send Lua command to Frame
  var luaCommand = "frame.display.text('Hello, Frame!', 1, 1)frame.display.show()print('Response from Frame!')";
  await frameBle.sendLua(luaCommand, {showMe: true, awaitPrint: true});

  // Wait for a couple of seconds to allow the command to execute and text to be displayed
  await new Promise(resolve => setTimeout(resolve, 2000));

  await frameBle.disconnect();
};
```
