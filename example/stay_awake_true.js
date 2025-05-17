import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connct to Frame
  const deviceId = await frameBle.connect();

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal();

  // Keep Frame awake even in charging cradle (for development)
  await frameBle.sendLua("frame.stay_awake(true);print(0)", {awaitPrint: true})

  // Disconnect from Frame
  await frameBle.disconnect();
};
