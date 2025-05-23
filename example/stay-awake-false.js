import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connect to Frame
  const deviceId = await frameBle.connect();

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal();

  // Restore normal behavior that Frame turns off when placed in the charging cradle (and puts it to sleep now)
  await frameBle.sendLua("frame.stay_awake(false);print(0)", {awaitPrint: true})
  await frameBle.sendLua("frame.sleep()")
  console.log("Frame will switch off when placed in the charging cradle, and will be put to sleep now (tap to wake)")

  // Disconnect from Frame
  await frameBle.disconnect();
};
