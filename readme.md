实现了串口的多路复用
同一个串口可以切分多个信道独立通信

基于以上功能实现将http代理转发到串口

```
Usage: node ./dist/index.js <command> [options]
General options:
  --serial-port, -s <path>
    Specify the serial port to connect.        
    Default: . (Use the first available port)  
  --baud-rate, -b <baudRate>
    Specify the baud rate.
    Default: 1600000

Commands:
  list
    List all available serial ports.
  proxy [options]
    Start the intermedia proxy server.
    Options:
      --listen, -l <ip>
        Specify the IP address to listen.      
        Default: 0.0.0.0
      --port, -p <port>
        Specify the port to listen.
        Default: 13808
  host [options]
    Start the host proxy server, where the real traffic outlets.
```
