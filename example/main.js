import { FrameBle } from 'frame-ble';

document.getElementById('connect').onclick = async () => {
  console.log("Instantiating FrameBle...");
  const frameBle = new FrameBle();

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };

  console.log("Connecting to Frame...");
  const deviceId = await frameBle.connect("Frame", printHandler, null);
  console.log('Connected to:', deviceId);

  const luaCommand = "frame.display.text('Hello, Frame!', 1, 1)\nframe.display.show()\nprint(0)";
  await frameBle.sendLua(luaCommand, true, true);
};
