实现了串口的多路复用
同一个串口可以切分多个信道独立通信

基于以上功能实现

--- 将http代理转发到串口
--- 消息、文件、图片数据传输
--- 远程Shell

注：功能1需要代理端启用 ```host``` 命令， 并在流量出口端启用 ```proxy``` 命令
注：功能2、3需要两边同时启用 ```msg``` 命令

```
Usage: node ./dist/index.js <command> [options]
General options:
  --serial-port=<path1, path2,...> | -s
    Specify the serial ports to connect, use comma to separate multiple ports.

    If multiple ports are specified, the first port will be used as the primary port, and 
    load-balance will be enabled automatically.

    ***
    Note: Using multiple ports is not means to create a multi-channel, it's for load-balance.
          You still can create multi-channel by using the same port multiple times.
          Using multiple serial ports does not increase bandwidth, but it can significantly improve concurrency capabilities.
    ***

    Default: . (Use the first available port)  

  --baud-rate=<baudRate1, baudRate2,...> | -b 
    Specify the baud rates, use comma to separate multiple rates for different ports.
    Default: 1600000

Commands:
  list
    List all available serial ports.

  proxy [options]
    Start the proxy endpoint, which the traffic outlet.

  host [options]
    Start the intermedia proxy host. All requests will be forwarded to the proxy endpoint through the serial ports binding.
    Options:
      --listen=<ip>, -l
        Specify the IP address to listen.      
        Default: 0.0.0.0

      --port=<port>, -p
        Specify the port to listen.
        Default: 13808

  msg [options]
    Send text/image/file to the specified channel. Or start remote shell.
    Options:
      --listen=<ip>, -l
        Specify the IP address to listen.      
        Default: 127.0.0.1
        
      --port=<port>, -p
        Specify the port to listen.
        Default: 13809
```
