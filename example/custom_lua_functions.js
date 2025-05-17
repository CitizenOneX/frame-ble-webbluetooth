import { FrameBle } from 'frame-ble';
import fibonacciLua from './lua/fibonacci.lua?raw';

export async function run() {
  const frameBle = new FrameBle();

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };

  // Connct to Frame
  const deviceId = await frameBle.connect({printResponseHandler: printHandler});

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal();

  // Send a lua script to Frame and "require" it to run it
  await frameBle.uploadFileFromString(fibonacciLua, "fibonacci.lua");
  await frameBle.sendLua("require('fibonacci');print(0)", {awaitPrint: true})

  // we can call the function(s) loaded from the file
  const myFibNum = 20
  const response = await frameBle.sendLua(`print(fibonacci(${myFibNum}))`, {awaitPrint: true})
  console.log(`Answer was: ${response}`)

  // Disconnect from Frame
  await frameBle.disconnect();
};
