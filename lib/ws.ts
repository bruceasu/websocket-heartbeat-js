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

export const CmdConstants = {
  /** 心跳 pong */
  CMD_PING: 0,
  /** 心跳 pong */
  CMD_PONG: 1,
  /** 关闭 */
  CMD_CLOSE: 2,
  /** 登录 */
  CMD_LOGIN: 3,
  /** 注销 */
  CMD_LOGOUT: 4,

  /** 在其他地方登录，当前连接被踢出。 */
  CMD_KICK: 5,

  /** 清除新消息标记 */
  CMD_CLEAR_RED_POINT: 6,

  /** 设置消息已阅 */
  CMD_SET_READ: 7,

  /** 应用用户的系统消息 */
  CMD_MESSAGE: 8,

  /** 设置新消息标记 */
  CMD_SET_RED_POINT: 9,

  /** 新消息数量 */
  CMD_GET_NEW_MESSAGE_NUM: 10,
};

// common message format.
export interface WSMessage {
  cmd: number;
  seq?: string;
  payload?: string;
  metadata?: string;
}

export interface Options {
  url: string,
  pingTimeout?: number,
  pongTimeout?: number,
  reconnectTimeout?: number,
  pingMsg?: string,
  repeatLimit?: number
}

export default class WebSocketClient {

  public onclose: Function;
  public onerror: Function;
  public onopen: Function;
  public onmessage: Function;
  public onreconnect: Function;

  private HEARTBEAT_MSG: WSMessage = {cmd: CmdConstants.CMD_PING};
  private DEFAULT_PING_TIMEOUT = 15000;
  private DEFAULT_PONG_TIMEOUT = 10000;
  private DEFAULT_RECONN_TIMEOUT = 2000;

  private opts: Options;
  private ws: WebSocket;
  private repeat: number;
  private lockReconnect: boolean = false;
  private forbidReconnect: boolean = false;
  private pingTimeoutId: number;
  private pongTimeoutId: number;

  constructor(opts) {
    const {
      url,
      pingTimeout = this.DEFAULT_PING_TIMEOUT,
      pongTimeout = this.DEFAULT_PONG_TIMEOUT,
      reconnectTimeout = this.DEFAULT_RECONN_TIMEOUT,
      pingMsg = JSON.stringify(this.HEARTBEAT_MSG),
      repeatLimit = null
    } = opts;
    this.opts = {
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
    this.onclose = () => {
    };
    this.onerror = () => {
    };
    this.onopen = () => {
    };
    this.onmessage = () => {
    };
    this.onreconnect = () => {
    };

    this.createWebSocket();
  }

  createWebSocket() {
    try {
      this.ws = new WebSocket(this.opts.url);
      // var sock;
      // if ('WebSocket' in window) {
      //   sock = new WebSocket(this.opts.url);
      // } else {
      //   //sock = new SockJS(this.opts.url);
      // }
      // this.ws = sock;
      this.initEventHandle();
    } catch (e) {
      this.reconnect();
      throw e;
    }
  };

  initEventHandle() {
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

  reconnect() {
    if (this.opts.repeatLimit > 0 && this.opts.repeatLimit <= this.repeat) return;//limit repeat the number
    if (this.lockReconnect || this.forbidReconnect) return;
    this.lockReconnect = true;
    this.repeat++;//必须在lockReconnect之后，避免进行无效计数
    this.onreconnect();
    //没连接上会一直重连，设置延迟避免请求过多
    setTimeout(() => {
      this.createWebSocket();
      this.lockReconnect = false;
    }, this.opts.reconnectTimeout);
  };

  // 发送消息
  send(msg) {
    console.log("ws sending ", msg);
    this.ws.send(msg);
  };

  // 发送二进制数据
  sendBinary(payload) {
    function getBytes(text) {
      var bytes = [];
      for (var i = 0; i < text.length; i++) {
        var charCode = text.charCodeAt(i);
        var cLen = Math.ceil(Math.log(charCode) / Math.log(256));
        for (var j = 0; j < cLen; j++) {
          bytes.push((charCode << (j * 8)) & 0xFF);
        }
      }
      return bytes;
    };
    var buffer = new ArrayBuffer(payload.length);
    var intView = new Int8Array(buffer);
    var bytes = getBytes(payload);
    for (var i = 0; i < intView.length; i++) {
      intView[i] = bytes[i];
    }
    this.ws.send(intView);
  };

  // 发送命令
  sendCmd(cmd, payload, metadata) {
    const msg: WSMessage = {cmd, payload, metadata};
    this.send(JSON.stringify(msg));
  }

  // Heartbeat detection
  heartCheck() {
    this.heartReset();
    this.heartStart();
  };

  heartStart() {
    if (this.forbidReconnect) {
      this.heartReset();
      //不再重连就不再执行心跳
      return;
    }
    this.pingTimeoutId = setTimeout(() => {
      //这里发送一个心跳，后端收到后，返回一个心跳消息，
      //onmessage 拿到返回的心跳就说明连接正常
      console.debug("sending heart beart:", this.opts.pingMsg);
      this.ws.send(this.opts.pingMsg);
      //如果超过一定时间还没重置，说明后端主动断开了
      this.pongTimeoutId = setTimeout(() => {
        //如果onclose会执行reconnect，我们执行ws.close()就行了.如果直接执行reconnect 会触发onclose导致重连两次
        this.ws.close();
      }, this.opts.pongTimeout);
    }, this.opts.pingTimeout);
  };

  heartReset() {
    clearTimeout(this.pingTimeoutId);
    clearTimeout(this.pongTimeoutId);
  };

  close() {
    //如果手动关闭连接，不再重连
    this.forbidReconnect = true;
    this.heartReset();
    this.ws.close();
  };
}

