import { NetConnectOpts } from "net";
import { Channel } from "../model/Channel";
import { RequestOptions, request } from "https";
import { connect } from "net";

export function redirectRequestToChn(reqInfo: RequestOptions, chn: Channel, onClose: () => void) {
  
  const pReq = request(reqInfo, function (pRes) {
    pRes.pipe(chn);

    console.log("[ProxyEndPoint/Request]", chn.cid, "Connected");
  }).on("error", function (e) {
    console.log("ERROR", request, e);
    chn.push(null);
  });

  chn.pipe(pReq);
  pReq.once("close", onClose);
}

export function redirectConnectToChn(reqInfo: NetConnectOpts, chn: Channel, onClose: () => void) {
  const socket = connect(reqInfo, function () {
    chn.write(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));

    socket.pipe(chn);
    chn.pipe(socket);

    console.log("[ProxyEndPoint/Socket]", chn.cid, "Connected");
  }).on("error", function (e) {
    console.log("ERROR", reqInfo, e);
    chn.push(null);
  });

  socket.once("close", onClose);
}
