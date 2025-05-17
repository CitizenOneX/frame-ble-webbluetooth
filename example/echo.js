import { FrameBle } from 'frame-ble';

export async function run() {
  window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled rejection:', event.reason);
  });

  const frameBle = new FrameBle();

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };

  // Connct to Frame
  const deviceId = await frameBle.connect({printResponseHandler: printHandler});

  // Send a break signal to Frame in case it is in a loop/main.lua
  await frameBle.sendBreakSignal({showMe: true});

  // Print literals or computed Lua expressions
  await frameBle.sendLua("print('echo!')", {awaitPrint: true});
  await frameBle.sendLua("print(5*5*5)", {awaitPrint: true});

  // Frame Lua API is available in these commands; see https://docs.brilliant.xyz/frame/building-apps-lua/
  await frameBle.sendLua("print(frame.FIRMWARE_VERSION)", {awaitPrint: true});
  await frameBle.sendLua("print(frame.battery_level())", {awaitPrint: true});

  // "Returns the amount of memory currently used by the program in Kilobytes."
  await frameBle.sendLua("print(collectgarbage('count'))", {awaitPrint: true});

  // Multiple statements are ok
  await frameBle.sendLua("my_var = 2^8; print(my_var)", {awaitPrint: true});

  // receive the printed response synchronously as a returned result from send_lua()
  var myExponent = 10;
  var response = await frameBle.sendLua("my_var = 2^" + myExponent + ";print(my_var)", {awaitPrint: true});
  console.log("Answer was: ", response);

  // we can define a global function that persists until a reset
  await frameBle.sendLua("fib=setmetatable({[0]=0,[1]=1},{__index=function(t,n) t[n]=t[n-1]+t[n-2]; return t[n] end});print(0)", {awaitPrint: true});
  var myFibNum = 20;
  // and then call it
  var fibAnswer = await frameBle.sendLua("print(fib[" + myFibNum + "])", {awaitPrint: true});
  console.log("Fibonacci number %d is: %s", myFibNum, fibAnswer);

  // If lines of code will be too long to fit in a single bluetooth packet(~240 bytes, depending)
  // then other strategies are needed, including sending Lua files to Frame and then calling their functions.
  // see custom_lua_functions.js for examples.
  // For structured message-passing of images, audio etc. between Frame and host, consider the frame-msg package.

  // Wait for a couple of seconds
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Disconnect from Frame
  await frameBle.disconnect();
};
