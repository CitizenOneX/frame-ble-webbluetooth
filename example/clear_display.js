import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connect to Frame
  const deviceId = await frameBle.connect();

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };
  frameBle.setPrintResponseHandler(printHandler);

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal({showMe: true});

  // Clear the Frame display
  var luaCommand = "frame.display.text('', 1, 1);frame.display.show();print(0)";
  await frameBle.sendLua(luaCommand, {showMe: true, awaitPrint: true});

  // Wait for a couple of seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Disconnect from Frame
  await frameBle.disconnect();
};
