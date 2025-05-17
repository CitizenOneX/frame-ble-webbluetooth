import { FrameBle } from 'frame-ble';

export async function run() {
  const frameBle = new FrameBle();

  // Connct to Frame
  const deviceId = await frameBle.connect();

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal();

  // Set the palette back to the firmware default
  await frameBle.sendLua("frame.display.assign_color_ycbcr(1, 0, 4, 4);print(0)", {awaitPrint: true}) // VOID
  await frameBle.sendLua("frame.display.assign_color_ycbcr(2, 15, 4, 4);print(0)", {awaitPrint: true}) // WHITE
  await frameBle.sendLua("frame.display.assign_color_ycbcr(3, 7, 4, 4);print(0)", {awaitPrint: true}) // GREY
  await frameBle.sendLua("frame.display.assign_color_ycbcr(4, 5, 3, 6);print(0)", {awaitPrint: true}) // RED
  await frameBle.sendLua("frame.display.assign_color_ycbcr(5, 9, 3, 5);print(0)", {awaitPrint: true}) // PINK
  await frameBle.sendLua("frame.display.assign_color_ycbcr(6, 2, 2, 5);print(0)", {awaitPrint: true}) // DARKBROWN
  await frameBle.sendLua("frame.display.assign_color_ycbcr(7, 4, 2, 5);print(0)", {awaitPrint: true}) // BROWN
  await frameBle.sendLua("frame.display.assign_color_ycbcr(8, 9, 2, 5);print(0)", {awaitPrint: true}) // ORANGE
  await frameBle.sendLua("frame.display.assign_color_ycbcr(9, 13, 2, 4);print(0)", {awaitPrint: true}) // YELLOW
  await frameBle.sendLua("frame.display.assign_color_ycbcr(10, 4, 4, 3);print(0)", {awaitPrint: true}) // DARKGREEN
  await frameBle.sendLua("frame.display.assign_color_ycbcr(11, 6, 2, 3);print(0)", {awaitPrint: true}) // GREEN
  await frameBle.sendLua("frame.display.assign_color_ycbcr(12, 10, 1, 3);print(0)", {awaitPrint: true}) // LIGHTGREEN
  await frameBle.sendLua("frame.display.assign_color_ycbcr(13, 1, 5, 2);print(0)", {awaitPrint: true}) // NIGHTBLUE
  await frameBle.sendLua("frame.display.assign_color_ycbcr(14, 4, 5, 2);print(0)", {awaitPrint: true}) // SEABLUE
  await frameBle.sendLua("frame.display.assign_color_ycbcr(15, 8, 5, 2);print(0)", {awaitPrint: true}) // SKYBLUE
  await frameBle.sendLua("frame.display.assign_color_ycbcr(16, 13, 4, 3);print(0)", {awaitPrint: true}) // CLOUDBLUE

  // Disconnect from Frame
  await frameBle.disconnect();
};
