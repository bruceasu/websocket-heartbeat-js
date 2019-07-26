/**
 * `WebSocketClient` constructor.
 *
 * @param {Object} opts
 * {
 *  url,              Websocket link address
 *  pingTimeout,      Send a ping request after not receiving the message for a few seconds. Default 15000 milliseconds.
 *  pongTimeout,      After sending the ping, the message timeout time is not received, the default is 10000 milliseconds.
 *  reconnectTimeout, The reconnet timeout, unit is millisseconds.
 *  pingMsg,          The ping message
 * }
 * @api public
 */

const CMD_HEARTBEAT = 0;
const CMD_CLOSE = 1;

// common message format.
export function WSMessage({cmd = 0, seq, payload, metadata = {}}) {
  this.cmd = cmd;
  this.seq = seq;
  this.payload = payload;
  this.metadata = metadata;
}


const HEARTBEAT_MSG = WSMessage({cmd: 0});
const DEFAULT_PING_TIMEOUT = 15000;
const DEFAULT_PONG_TIMEOUT = 10000;
const DEFAULT_RECONN_TIMEOUT = 2000;

function WebSocketClient({
  url,
  pingTimeout = DEFAULT_PING_TIMEOUT,
  pongTimeout = DEFAULT_PONG_TIMEOUT,
  reconnectTimeout = DEFAULT_RECONN_TIMEOUT,
  pingMsg = HEARTBEAT_MSG,
  repeatLimit = null
}){
  this.opts ={
    url: url,
    pingTimeout: pingTimeout,
    pongTimeout: pongTimeout,
    reconnectTimeout: reconnectTimeout,
    pingMsg: pingMsg,
    repeatLimit: repeatLimit
  };
  this.ws = null;//websocket实例
  this.repeat = 0;

  //override hook function
  this.onclose = () => {};
  this.onerror = () => {};
  this.onopen = () => {};
  this.onmessage = () => {};
  this.onreconnect = () => {};

  this.createWebSocket();
}

WebSocketClient.prototype.createWebSocket = function(){
  try {
    //this.ws = new WebSocket(this.opts.url);
    var sock;
    if ('WebSocket' in window) {
      sock = new WebSocket(this.opts.url);
    } else if ('MozWebSocket' in window) {
      sock = new MozWebSocket(this.opts.url);
    } else {
      //sock = new SockJS(this.opts.url);
    }
    this.ws = sock;
    this.initEventHandle();
  } catch (e) {
    this.reconnect();
    throw e;
  }
};

WebSocketClient.prototype.initEventHandle = function(){
  this.ws.onclose = () => {
    this.onclose();
    this.reconnect();
  };
  this.ws.onerror = () => {
    this.onerror();
    this.reconnect();
  };
  this.ws.onopen = () => {
    this.repeat = 0;
    this.onopen();
    //心跳检测重置
    this.heartCheck();
  };
  this.ws.onmessage = (event) => {
    this.onmessage(event);
    //如果获取到消息，心跳检测重置
    //拿到任何消息都说明当前连接是正常的
    this.heartCheck();
  };
};

WebSocketClient.prototype.reconnect = function(){
  if(this.opts.repeatLimit>0 && this.opts.repeatLimit <= this.repeat) return;//limit repeat the number
  if(this.lockReconnect || this.forbidReconnect) return;
  this.lockReconnect = true;
  this.repeat++;//必须在lockReconnect之后，避免进行无效计数
  this.onreconnect();
  //没连接上会一直重连，设置延迟避免请求过多
  setTimeout(() => {
    this.createWebSocket();
    this.lockReconnect = false;
  }, this.opts.reconnectTimeout);
};

WebSocketClient.prototype.send = function(msg){
  this.ws.send(msg);
};

WebSocketClient.proptype.sendBinary = function (payload) {
  function getBytes(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var charCode = text.charCodeAt(i);
      var cLen = Math.ceil(Math.log(charCode)/Math.log(256));
      for (var j = 0; j < cLen; j++) {
        bytes.push((charCode << (j*8)) & 0xFF);
      }
    }
    return bytes;
  };

  var buffer = new ArrayBuffer(payload.length);
  var intView = new Int8Array(buffer);
  var bytes =  getBytes(payload);
  for(var i = 0; i < intView.length; i++) {
    intView[i] = bytes[i];
  }
  this.ws.send(intView);
};



WebSocketClient.prototype.sendCmd = function (cmd, payload, metadata) {
  const msg = WSMessage(cmd, payload, metadata);
  this.send(JSON.stringify(msg));
}

// Heartbeat detection
WebSocketClient.prototype.heartCheck = function(){
  this.heartReset();
  this.heartStart();
};
WebSocketClient.prototype.heartStart = function(){
  if(this.forbidReconnect) return;//不再重连就不再执行心跳
  this.pingTimeoutId = setTimeout(() => {
    //这里发送一个心跳，后端收到后，返回一个心跳消息，
    //onmessage拿到返回的心跳就说明连接正常
    this.ws.send(this.opts.pingMsg);
    //如果超过一定时间还没重置，说明后端主动断开了
    this.pongTimeoutId = setTimeout(() => {
      //如果onclose会执行reconnect，我们执行ws.close()就行了.如果直接执行reconnect 会触发onclose导致重连两次
      this.ws.close();
    }, this.opts.pongTimeout);
  }, this.opts.pingTimeout);
};
WebSocketClient.prototype.heartReset = function(){
  clearTimeout(this.pingTimeoutId);
  clearTimeout(this.pongTimeoutId);
};
WebSocketClient.prototype.close = function(){
  //如果手动关闭连接，不再重连
  this.forbidReconnect = true;
  this.heartReset();
  this.ws.close();
};
if(window) window.WebSocketClient = WebSocketClient;
export default WebSocketClient;
