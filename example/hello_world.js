import { FrameBle } from 'frame-ble';

document.getElementById('run').onclick = async () => {
  console.log("Instantiating FrameBle...");
  const frameBle = new FrameBle();

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };

  // Web Bluetooth API requires a user gesture to initiate the connection
  // This is usually a button click or similar event
  console.log("Connecting to Frame...");
  const deviceId = await frameBle.connect({namePrefix: "Frame", printResponseHandler: printHandler});
  console.log('Connected to:', deviceId);

  // Send Lua command to Frame
  console.log("Sending Lua command to Frame...");
  var luaCommand = "frame.display.text('Hello, Frame!', 1, 1)frame.display.show()print('Response from Frame!')";
  await frameBle.sendLua(luaCommand, {showMe: true, awaitPrint: true});
  console.log("Lua command sent.");

  // Wait for a couple of seconds to allow the command to execute and text to be displayed
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Send Lua command to Frame
  console.log("Sending Lua command to Frame...");
  luaCommand = "frame.display.text('Goodbye, Frame!', 1, 1)frame.display.show()print('Response from Frame!')";
  await frameBle.sendLua(luaCommand, {showMe: true, awaitPrint: true});
  console.log("Lua command sent.");

  // Wait for a couple of seconds to allow the command to execute and text to be displayed
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("Disconnecting from Frame...");
  await frameBle.disconnect();
  console.log("Disconnected from Frame.");
};
