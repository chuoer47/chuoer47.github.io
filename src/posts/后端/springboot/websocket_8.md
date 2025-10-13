---
title: WebSocket
date: 2024-06-22
tags: Spring
category: Spring
order: 8
icon: "/img/WebSocket.svg"
---

<!--more--->

# WebSocket

## 一、介绍

WebSocket 是基于 TCP 的一种新的网络协议。它实现了浏览器与服务器全双工通信——浏览器和服务器只需要完成一次握手，两者之间就可以创建持久性的连接， 并进行双向数据传输。WebSocket 使得客户端和服务器之间的数据交换变得更加简单，允许服务端主动向客户端推送数据。在 WebSocket API 中，浏览器和服务器只需要完成一次握手，两者之间就可以创建持久性的连接，并进行双向数据传输。

### **1）特点：**

（1）建立在` TCP 协议`之上，服务器端的实现比较容易。

（2）与 `HTTP 协议`有着良好的兼容性。默认端口也是80和443，并且`握手阶段`采用 HTTP 协议，因此握手时不容易屏蔽，`能通过各种 HTTP 代理服务器`。

（3）数据格式比较轻量，性能开销小，通信高效。

（4）可以发送`文本`，也可以发送`二进制数据`（`blob`对象或`Arraybuffer`对象）

（5）收到的数据类型 可以使用binaryType 指定， 显式指定收到的二进制数据类型

（6）没有`同源限制`，客户端可以与任意服务器通信。

（7）协议标识符是`ws（握手http）`（如果加密，则为`wss（tcp +TLS)`），服务器网址就是 URL

::: tip 为什么需要websocket

因为http 通信只能由客户端发起,服务器返回查询结果,HTTP 协议做不到服务器主动向客户端推送信息, 服务器有连续的状态变化，客户端要获知就非常麻烦。只能使用**轮询**(每隔一段时候，就发出一个询问，了解服务器有没有新的信息。最典型的场景就是聊天室。)轮询的效率低，非常浪费资源（因为必须不停连接，或者 HTTP 连接始终打开）;

:::

### **2）websocket 与http区别**：

**连接方式不同：** HTTP 是一种单向请求-响应协议，每次请求需要重新建立连接，而 WebSocket 是一种双向通信协议，使用长连接实现数据实时推送。http 长连接只能基于简单的超时（常见为65s），websocket 链接基于ping/pong 心跳机制维持。

**数据传输方式不同：** HTTP 协议中的数据传输是文本格式的，而 WebSocket 可以传输文本和二进制数据。

**通信类型不同：** HTTP 主要用于客户端和服务器之间的请求和响应，如浏览器请求网页和服务器返回网页的 HTML 文件。WebSocket 可以实现双向通信，常常用于实时通信场景。

**性能方面不同：** 由于 HTTP 的每次请求都需要建立连接和断开连接，而 WebSocket 可以在一次连接上进行多次通信，WebSocket 在性能上比 HTTP 有优势。



### **3）websocket 与socket区别**：

**协议不同：** Socket 是基于传输层 TCP 协议的，而 Websocket 是基于 HTTP 协议的。Socket 通信是通过 Socket 套接字来实现的，而 Websocket 通信是通过 HTTP 的握手过程实现的。

**持久化连接：** 传统的 Socket 通信是基于短连接的，通信完成后即断开连接。而 Websocket 将 HTTP 协议升级后，实现了长连接，即建立连接后可以持续通信，避免了客户端与服务端频繁连接和断开连接的过程。

**双向通信：** 传统的 Socket 通信只支持单向通信，即客户端向服务端发送请求，服务端进行响应。而 Websocket 可以实现双向通信，即客户端和服务端都可以发起消息，实时通信效果更佳。

**效率：** Socket 通信具有高效性和实时性，因为传输数据时没有 HTTP 协议的头信息，而 Websocket 除了HTTP协议头之外，还需要发送额外的数据，因此通信效率相对较低。

**应用场景：** Socket 适用于实时传输数据，例如在线游戏、聊天室等需要快速交换数据的场景。而 Websocket 适用于需要长时间保持连接的场景，例如在线音视频、远程控制等。



::: info websocket优点

- **较少的控制开销** ：在连接创建后，服务器和客户端之间交换数据时，用于协议控制的数据包头部相对较小；
- **更强的实时性**：由于协议是全双工的，所以服务器可以随时主动给客户端下发数据。相对于 HTTP 请求需要等待客户端发起请求服务端才能响应，延迟明显更少；
- **保持连接状态**：与 HTTP 不同的是，WebSocket 需要先创建连接，这就使得其成为一种有状态的协议，之后通信时可以省略部分状态信息；
- **更好的二进制支持**：WebSocket 定义了二进制帧，相对 HTTP，可以更轻松地处理二进制内容；
- **可以支持扩展**：WebSocket 定义了扩展，用户可以扩展协议、实现部分自定义的子协议。

:::

::: warning websocket缺点

•服务器长期维护长连接需要一定的成本

•各个浏览器支持程度不一

•WebSocket 是长连接，受网络限制比较大，需要处理好重连

注意： **WebSocket并不能完全取代HTTP，它只适合在特定的场景下使用**

:::

## 二、快速使用

实现步骤：

​	①直接使用websocket.html页面作为WebSocket客户端

​	②导入WebSocket的maven坐标

​	③导入WebSocket服务端组件WebSocketServer，用于和客户端通信

​	④导入配置类WebSocketConfiguration，注册WebSocket的服务端组件

​	⑤导入定时任务类WebSocketTask，定时向客户端推送数据

### **1）websocket客户端**

```html
<!DOCTYPE HTML>
<html>
<head>
    <meta charset="UTF-8">
    <title>WebSocket Demo</title>
</head>
<body>
    <input id="text" type="text" />
    <button onclick="send()">发送消息</button>
    <button onclick="closeWebSocket()">关闭连接</button>
    <div id="message">
    </div>
</body>
<script type="text/javascript">
    var websocket = null;
    var clientId = Math.random().toString(36).substr(2);

    //判断当前浏览器是否支持WebSocket
    if('WebSocket' in window){
        //连接WebSocket节点
        websocket = new WebSocket("ws://localhost:8080/ws/"+clientId);
    }
    else{
        alert('Not support websocket')
    }

    //连接发生错误的回调方法
    websocket.onerror = function(){
        setMessageInnerHTML("error");
    };

    //连接成功建立的回调方法
    websocket.onopen = function(){
        setMessageInnerHTML("连接成功");
    }

    //接收到消息的回调方法
    websocket.onmessage = function(event){
        setMessageInnerHTML(event.data);
    }

    //连接关闭的回调方法
    websocket.onclose = function(){
        setMessageInnerHTML("close");
    }

    //监听窗口关闭事件，当窗口关闭时，主动去关闭websocket连接，防止连接还没断开就关闭窗口，server端会抛异常。
    window.onbeforeunload = function(){
        websocket.close();
    }

    //将消息显示在网页上
    function setMessageInnerHTML(innerHTML){
        document.getElementById('message').innerHTML += innerHTML + '<br/>';
    }

    //发送消息
    function send(){
        var message = document.getElementById('text').value;
        websocket.send(message);
    }
	
	//关闭连接
    function closeWebSocket() {
        websocket.close();
    }
</script>
</html>
```

### **2）导入maven坐标**

```xml
		<dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-websocket</artifactId>
        </dependency>
```

### 3）导入服务端组件WebSocketServer

```java
package com.sky.websocket;
import org.springframework.stereotype.Component;
import javax.websocket.OnClose;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.PathParam;
import javax.websocket.server.ServerEndpoint;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

/**
 * WebSocket服务
 */
@Component
@ServerEndpoint("/ws/{sid}")
public class WebSocketServer {

    //存放会话对象
    private static Map<String, Session> sessionMap = new HashMap();

    /**
     * 连接建立成功调用的方法
     */
    @OnOpen
    public void onOpen(Session session, @PathParam("sid") String sid) {
        System.out.println("客户端：" + sid + "建立连接");
        sessionMap.put(sid, session);
    }

    /**
     * 收到客户端消息后调用的方法
     *
     * @param message 客户端发送过来的消息
     */
    @OnMessage
    public void onMessage(String message, @PathParam("sid") String sid) {
        System.out.println("收到来自客户端：" + sid + "的信息:" + message);
    }

    /**
     * 连接关闭调用的方法
     *
     * @param sid
     */
    @OnClose
    public void onClose(@PathParam("sid") String sid) {
        System.out.println("连接断开:" + sid);
        sessionMap.remove(sid);
    }

    /**
     * 群发
     *
     * @param message
     */
    public void sendToAllClient(String message) {
        Collection<Session> sessions = sessionMap.values();
        for (Session session : sessions) {
            try {
                //服务器向客户端发送消息
                session.getBasicRemote().sendText(message);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

}
```

### 4）导入配置类WebSocketConfiguration

```java
package com.sky.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.server.standard.ServerEndpointExporter;

/**
 * WebSocket配置类，用于注册WebSocket的Bean
 */
@Configuration
public class WebSocketConfiguration {

    @Bean
    public ServerEndpointExporter serverEndpointExporter() {
        return new ServerEndpointExporter();
    }

}
```

### 5）导入定时任务类 WebSocketTask

```java
package com.sky.task;

import com.sky.websocket.WebSocketServer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Component
public class WebSocketTask {
    @Autowired
    private WebSocketServer webSocketServer;

    /**
     * 通过WebSocket每隔5秒向客户端发送消息
     */
    @Scheduled(cron = "0/5 * * * * ?")
    public void sendMessageToClient() {
        webSocketServer.sendToAllClient("这是来自服务端的消息：" + 			       DateTimeFormatter.ofPattern("HH:mm:ss").format(LocalDateTime.now()));
    }  
}
```



# 参考

[1] [https://juejin.cn/post/6989539483695710215](https://juejin.cn/post/6989539483695710215)