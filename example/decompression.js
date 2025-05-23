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
  await frameBle.sendBreakSignal();

  var luaScript = `
  function decomp_func(data)
      print(data)
  end

  frame.compression.process_function(decomp_func)

  function ble_func(data)
      frame.compression.decompress(data, 1024)
  end

  frame.bluetooth.receive_callback(ble_func)
  `;

  // Send a lua script to Frame and "require" it to run it
  await frameBle.uploadFileFromString(luaScript, "frame_app.lua");
  await frameBle.sendLua("require('frame_app');print(0)", {awaitPrint: true})

  // Send the compressed data. Here the total size of the data is is pretty small,
  // but usually you would want to split the data into MTU sized chunks and stitch
  // them together on the device side before decompressing.
  let compressedData = new Uint8Array([0x04, 0x22, 0x4d, 0x18, 0x64, 0x40, 0xa7, 0x6f, 0x00, 0x00, 0x00, 0xf5, 0x3d, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0x20, 0x49, 0x20, 0x77, 0x61, 0x73, 0x20, 0x73, 0x6f, 0x6d, 0x65, 0x20, 0x63, 0x6f, 0x6d, 0x70, 0x72, 0x65, 0x73, 0x73, 0x65, 0x64, 0x20, 0x64, 0x61, 0x74, 0x61, 0x2e, 0x20, 0x49, 0x6e, 0x20, 0x74, 0x68, 0x69, 0x73, 0x20, 0x63, 0x61, 0x73, 0x65, 0x2c, 0x20, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x73, 0x20, 0x61, 0x72, 0x65, 0x6e, 0x27, 0x74, 0x20, 0x70, 0x61, 0x72, 0x74, 0x69, 0x63, 0x75, 0x6c, 0x61, 0x72, 0x6c, 0x79, 0x3b, 0x00, 0xf1, 0x01, 0x69, 0x62, 0x6c, 0x65, 0x2c, 0x20, 0x62, 0x75, 0x74, 0x20, 0x73, 0x70, 0x72, 0x69, 0x74, 0x65, 0x49, 0x00, 0xa0, 0x20, 0x77, 0x6f, 0x75, 0x6c, 0x64, 0x20, 0x62, 0x65, 0x2e, 0x00, 0x00, 0x00, 0x00, 0x5f, 0xd0, 0xa3, 0x47]);
  await frameBle.sendData(compressedData);

  // Wait for a second to allow the command to execute and decompressed response to be sent back
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Disconnect from Frame
  await frameBle.disconnect();
};
