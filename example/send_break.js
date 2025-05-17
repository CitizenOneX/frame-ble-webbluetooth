import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connct to Frame
  const deviceId = await frameBle.connect();

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal();

  // Disconnect from Frame
  await frameBle.disconnect();
};
