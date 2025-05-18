import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connect to Frame
  const deviceId = await frameBle.connect();

  // Send a reset signal to Frame to reboot it
  await frameBle.sendResetSignal();

  // Disconnect from Frame
  await frameBle.disconnect();
};
