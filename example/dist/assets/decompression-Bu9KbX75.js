import{F as r}from"./frame-ble-Boz78onj.js";async function o(){const x=new r;await x.connect();const a=e=>{console.log("Frame response:",e)};x.setPrintResponseHandler(a),await x.sendBreakSignal();var n=`
  function decomp_func(data)
      print(data)
  end

  frame.compression.process_function(decomp_func)

  function ble_func(data)
      frame.compression.decompress(data, 1024)
  end

  frame.bluetooth.receive_callback(ble_func)
  `;await x.uploadFileFromString(n,"frame_app.lua"),await x.sendLua("require('frame_app');print(0)",{awaitPrint:!0});let t=new Uint8Array([4,34,77,24,100,64,167,111,0,0,0,245,61,72,101,108,108,111,33,32,73,32,119,97,115,32,115,111,109,101,32,99,111,109,112,114,101,115,115,101,100,32,100,97,116,97,46,32,73,110,32,116,104,105,115,32,99,97,115,101,44,32,115,116,114,105,110,103,115,32,97,114,101,110,39,116,32,112,97,114,116,105,99,117,108,97,114,108,121,59,0,241,1,105,98,108,101,44,32,98,117,116,32,115,112,114,105,116,101,73,0,160,32,119,111,117,108,100,32,98,101,46,0,0,0,0,95,208,163,71]);await x.sendData(t),await new Promise(e=>setTimeout(e,1e3)),await x.disconnect()}export{o as run};
