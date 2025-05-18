import{F as i}from"./frame-ble-Boz78onj.js";const t=`function fibonacci(n)\r
    if n <= 0 then\r
        return 0\r
    elseif n == 1 then\r
        return 1\r
    else\r
        local a = 0\r
        local b = 1\r
        for i = 2, n do\r
            local temp = a + b\r
            a = b\r
            b = temp\r
        end\r
        return b\r
    end\r
end\r
`;async function s(){const n=new i;await n.connect();const r=a=>{console.log("Frame response:",a)};n.setPrintResponseHandler(r),await n.sendBreakSignal(),await n.uploadFileFromString(t,"fibonacci.lua"),await n.sendLua("require('fibonacci');print(0)",{awaitPrint:!0});const e=await n.sendLua("print(fibonacci(20))",{awaitPrint:!0});console.log(`Answer was: ${e}`),await n.disconnect()}export{s as run};
