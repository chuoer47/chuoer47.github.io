---
title: Netty进阶
date: 2024-11-07 16:24:22
tags: 网络编程
order: 22
---



# Netty进阶

## 一、Google Protobuf

### 1、编码和解码的基本介绍

1) 编写网络应用程序时，因为数据在网络中传输的都是二进制字节码数据，在发送数据时就需要编码，接收数据时就需要解码 [示意图]
2) codec(编解码器) 的组成部分有两个：decoder(解码器)和 encoder(编码器)。encoder 负责把业务数据转换成字节
码数据，decoder 负责把字节码数据转换成业务数据

![](/image/jvm/jvm113.png)

### 2、Netty 本身的编码解码的机制和问题分析

Netty 自身提供了一些 codec(编解码器)

- StringEncoder，对字符串数据进行编码
- ObjectEncoder，对 Java 对象进行编码

Netty 本身自带的 ObjectDecoder 和 ObjectEncoder 可以用来实现 POJO 对象或各种业务对象的编码和解码，底层使用的仍是 Java 序列化技术 , 而 Java 序列化技术本身效率就不高，存在如下问题：

- 无法跨语言
- 序列化后的体积太大，是二进制编码的 5 倍多。
- 序列化性能太低

### 3、Protobuf

Protobuf 是 Google 发布的开源项目，全称 Google Protocol Buffers，是一种轻便高效的结构化数据存储格式，可以用于结构化数据串行化，或者说序列化。它很适合做数据存储或 RPC[远程过程调用 remote procedure call ] 数据交换格式 。目前很多公司 http+json tcp+protobuf，[参考文档]( https://developers.google.com/protocol-buffers/docs/proto)

- Protobuf 是以 message 的方式来管理数据的.
- 支持跨平台、跨语言，即[客户端和服务器端可以是不同的语言编写的] （支持目前绝大多数语言，例如 C++、C#、Java、python 等）
- 高性能，高可靠性
- 使用 protobuf 编译器能自动生成代码，Protobuf 是将类的定义使用.proto 文件进行描述。说明，在 idea 中编写 .proto 文件时，会自动提示是否下载 .ptotot 编写插件. 可以让语法高亮。然后通过 protoc.exe 编译器根据.proto 自动生成.java 文件

### 4、protobuf语法

- 类型：类型不仅可以是标量类型（`int`、`string`等），也可以是复合类型（`enum`等），也可以是其他`message`
- 字段名：字段名比较推荐的是使用下划线/分隔名称
- 字段编号：一个message内每一个字段编号都必须唯一的，在编码后其实传递的是这个编号而不是字段名
- 字段规则：消息字段可以是以下字段之一
    - `singular`：格式正确的消息可以有零个或一个字段（但不能超过一个）。使用 proto3 语法时，如果未为给定字段指定其他字段规则，则这是默认字段规则
    - `optional`：与 `singular` 相同，不过可以检查该值是否明确设置
    - `repeated`：在格式正确的消息中，此字段类型可以重复零次或多次。系统会保留重复值的顺序
    - `map`：这是一个成对的键值对字段
- 保留字段：为了避免再次使用到已移除的字段可以设定保留字段。如果任何未来用户尝试使用这些字段标识符，编译器就会报错

### 5、Protobuf 快速入门实例

**入门程序1:**

1. 客户端可以发送一个 Student PoJo 对象到服务器 (通过 Protobuf 编码)

2) 服务端能接收 Student PoJo 对象，并显示信息(通过 Protobuf 解码)

```protobuf
syntax = "proto3"; //版本
option java_outer_classname = "StudentPOJO";//生成的外部类名，同时也是文件名
//protobuf 使用 message 管理数据
message Student { //会在 StudentPOJO 外部类生成一个内部类 Student， 他是真正发送的 POJO 对象
int32 id = 1; // Student 类中有 一个属性 名字为 id 类型为 int32(protobuf 类型) 1 表示属性序号，不是值
string name = 2;
}
```

编译`protoc.exe --java_out=. Student.proto`将生成的 StudentPOJO 放入到项目使用

**入门程序2：**

1. 客户端可以随机发送 Student PoJo/ Worker PoJo 对象到服务器 (通过 Protobuf 编码)

2. 服务端能接收 Student PoJo/ Worker PoJo 对象(需要判断是哪种类型)，并显示信息(通过 Protobuf 解码

```protobuf
syntax = "proto3";
option optimize_for = SPEED; //加快解析
option java_package = "com.ruyi.netty.codec2"; //指定生成到哪个包下
option java_outer_classname = "MyDataInfo";

// protobuf 可以使用 message 管理其他message
message Mymessage{
  enum DataType{
    StudentType = 0; //在proto3要求enum编号从0开始
    WorkerType = 1;
  }

  DataType dataType = 1; //用dataType标识传的是哪一个枚举类型

  // 标识枚举类型每次最多只能出现其中的一个，节省空间
  oneof dataBody{
      Student student = 2;
      Worker worker = 3;
  }

}

message Student{
  int32 id = 1;
  string name = 2;
}
message Worker{
  string name = 1;
  int32  age = 2;
}
```

## 二、Netty 编解码器和 handler 的调用机制

### 1、编码解码器

- 1、当 Netty 发送或者接受一个消息的时候，就将会发生一次数据转换。入站消息会被解码：从字节转换为另一种格式（比如 java 对象）；如果是出站消息，它会被编码成字节。

- 2、Netty 提供一系列实用的编解码器，他们都实现了` ChannelInboundHadnler` 或者 `ChannelOutboundHandler` 接口。
    - 在这些类中，channelRead 方法已经被重写了。以入站为例，对于每个从入站 Channel 读取的消息，这个方法会被调用。随后，它将调用由解码器所提供的 decode()方法进行解码，并将已经解码的字节转发给 ChannelPipeline中的下一个 ChannelInboundHandler。

### 2、解码器-ByteToMessageDecoder

<center><img src="/image/jvm/jvm114.png" style="zoom:50%;" /></center>

由于不可能知道远程节点是否会一次性发送一个完整的信息，tcp 有可能出现粘包拆包的问题，这个类会对入站数据进行缓冲，直到它准备好被处理.

案例：

![](/image/jvm/jvm115.png)

**解码器-ReplayingDecoder**

`public abstract class ReplayingDecoder<S> extends ByteToMessageDecoder`

- ReplayingDecoder 扩展了 ByteToMessageDecoder 类，使用这个类，我们不必调用 readableBytes()方法。参数 S指定了用户状态管理的类型，其中 Void 代表不需要状态管理(不需要判断 `if(in.readableBytes()>=4)`)

::: warning ReplayingDecoder 使用方便，但它也有一些局限性：

- 1、并 不 是 所 有 的 ByteBuf 操 作 都 被 支 持 ， 如 果 调 用 了 一 个 不 被 支 持 的 方 法 ， 将 会 抛 出 一 个UnsupportedOperationException。

- ReplayingDecoder 在某些情况下可能稍慢于 ByteToMessageDecoder，例如网络缓慢并且消息格式复杂时，消息会被拆成了多个碎片，速度变慢

:::

### 3、Netty 的 handler 链的调用机制

在Netty中，Handler是一个接口，主要分为两种：`ChannelInboundHandler`(入站Handler)和`ChannelOutBoundHandler`(出站Handler)，如下图所示。

- `ChannelInboundHandler` ：处理从网络通道中读取到的数据，包括解码、反序列化、消息分发等操作；
- `ChannelOutboundHandler`：可以负责将处理结果编码、加密并通过网络通道发送出去等

::: tip 

- 不论解码器 handler 还是 编码器 handler 即接收的消息类型必须与待处理的消息类型一致，否则该 handler 不会被执行
- 在解码器 进行数据解码时，需要判断 缓存区(ByteBuf)的数据是否足够 ，否则接收到的结果会期望结果可能不一致

:::

**Handler 是怎么被组织起来的**

- 为了方便事件在各个Handler中处理与传递，在Netty中，每一个`ChannelHandler`被封装为一个`ChannelHandlerContext`
    - `ChannelHandlerContext`提供了对`ChannelHandler`的访问，以及它前后相邻的`ChannelHandler`的访问。在`ChannelHandlerContext`的抽象实现类`AbstractChannelHandlerContext`，可以很清楚的看到，它拥有`next`和`prev`两个属性，分别对应下一个和上一个`ChannelHandlerContext`
- 在Netty中，一个完整的处理链路可以由多个`ChannelHandlerContext`组成，这些`ChannelHandlerContext`形成一个**管道（Pipeline）** ，通过管道串联起来，形成完整的数据处理流程。在数据流经过管道中的每个`ChannelHandlerContext`时，都可以对数据进行一些特定的处理。

在`ChannelPipeline`的源码中，我们可以看到这样的一段注释

<center><img src="/image/jvm/jvm116.png" style="zoom:50%;" /></center>

这可能容易让人产生认为`Pipeline` 中维护了两条链表，其中一条用于处理出站事件，另外一条处理入站事件。

**实际上，`Pipeline`是维护了一条双向链表，当数据从入站方向流经处理程序链时，数据从双向链表的`head` 向后面遍历，依次将事件交由后面一个`handler`处理，当数据从出站方向流经处理程序链时，数据从双向链表的`tail` 向前面遍历，依次将事件交由下一个`handler`处理。**

![](/image/jvm/jvm117.png)

### 4、其它编解码器

**1）其它解码器**

- LineBasedFrameDecoder：这个类在 Netty 内部也有使用，它使用行尾控制字符（\n 或者\r\n）作为分隔符来解析数据。

- DelimiterBasedFrameDecoder：使用自定义的特殊字符作为消息的分隔符。

- HttpObjectDecoder：一个 HTTP 数据的解码器

- LengthFieldBasedFrameDecoder：通过指定长度来标识整包消息，这样就可以自动的处理黏包和半包消息

## 三、TCP 粘包和拆包及解决方案

### 1、介绍

**粘包**

- 现象，发送 `abc_def`，接收 `abcdef`
- 原因
    - 应用层：接收方 ByteBuf 设置太大（Netty 默认 1024）
    - 滑动窗口：假设发送方 256 bytes 表示一个完整报文，但由于接收方处理不及时且窗口大小足够大，这 256 bytes 字节就会缓冲在接收方的滑动窗口中，当滑动窗口中缓冲了多个报文就会粘包
    - Nagle 算法：也会造成粘包

**半包**

- 现象，发送 `abcdef`，接收 `abc_def`
- 原因
    - 应用层：接收方 ByteBuf 小于实际发送数据量
    - 滑动窗口：假设接收方的窗口只剩了 128 bytes，发送方的报文大小是 256 bytes，这时放不下了，只能先发送前 128 bytes，等待 ack 后才能发送剩余部分，这就造成了半包
    - MSS 限制：当发送的数据超过 MSS 限制后，会将数据切分发送，就会造成半包

**无论是粘包还是半包，本质原因在于 TCP 是一个无边界的流式协议。**

------

> **扩展1：MSS 限制**
>
> - 链路层对一次能够发送的最大数据有限制，这个限制称之为 MTU（maximum transmission unit），不同的链路设备的 MTU 值也有所不同，例如
> - 以太网的 MTU 是 1500
> - FDDI（光纤分布式数据接口）的 MTU 是 4352
> - 本地回环地址的 MTU 是 65535 - 本地测试不走网卡
> - MSS 是最大段长度（maximum segment size），它是 MTU 刨去 tcp 头和 ip 头后剩余能够作为数据传输的字节数
> - ipv4 tcp 头占用 20 bytes，ip 头占用 20 bytes，因此以太网 MSS 的值为 1500 - 40 = 1460
> - TCP 在传递大量数据时，会按照 MSS 大小将数据进行分割发送
> - MSS 的值在三次握手时通知对方自己 MSS 的值，然后在两者之间选择一个小值作为 MSS
>
> ![](/image/jvm/jvm118.jpg)

------

> **扩展2：Nagle 算法**
>
> - 即使发送一个字节，也需要加入 tcp 头和 ip 头，也就是总字节数会使用 41 bytes，非常不经济。因此为了提高网络利用率，tcp 希望尽可能发送足够大的数据，这就是 Nagle 算法产生的缘由
> - 该算法是指发送端即使还有应该发送的数据，但如果这部分数据很少的话，则进行延迟发送
>     - 如果 SO_SNDBUF 的数据达到 MSS，则需要发送
>     - 如果 SO_SNDBUF 中含有 FIN（表示需要连接关闭）这时将剩余数据发送，再关闭
>     - 如果 TCP_NODELAY = true，则需要发送
>     - 已发送的数据都收到 ack 时，则需要发送
>     - 上述条件不满足，但发生超时（一般为 200ms）则需要发送
>     - 除上述情况，延迟发送

### 2、解决方案

#### （1）短连接

发一个包建立一次连接，从连接的建立到断开就是消息的边界。

**缺点**

- 效率太低
- 无法解决半包问题，因为接收方的缓冲区大小仍然是有大小限制的

#### （2）定长消息

每条消息采用固定长度。

**服务端**

```java
// 注意先加 FrameDecoder, 再加 LoggingHandler
// 固定消息长度, 例如 8 Bytes
ch.pipeline().addLast(new FixedLengthFrameDecoder(8));
```

**客户端**

此时客户端可以在任何时候 flush

```java
byte[] bytes = fill10Bytes(c, r.nextInt(10) + 1);
buf.writeBytes(bytes);

public static byte[] fill10Bytes(char c, int len) {
    byte[] bytes = new byte[10];
    Arrays.fill(bytes, (byte) '_');
    for (int i = 0; i < len; i++) {
        bytes[i] = (byte) c;
    }
    return bytes;
}
```

**缺点**

数据包的大小不太好确定，如果太大，浪费资源，如果太小，不能满足某些大数据包的需求

#### （3）指定分隔符

每条消息采用固定的分隔符，默认是 `\n` 或 `\r\n`，如果超出指定长度仍未出现分隔符，则抛出异常。

**服务端**

```java
ch.pipeline().addLast(new LineBasedFrameDecoder(1024));
```

**客户端**

```java
StringBuilder sb = makeString(c, r.nextInt(16) + 1);
buf.writeBytes(sb.toString().getBytes());


public static StringBuilder makeString(char c, int len) {
    StringBuilder sb = new StringBuilder(len + 2);
    for (int i = 0; i < len; i++) {
        sb.append(c);
    }
    // 写入分隔符
    sb.append("\n");
    return sb;
}
```

**缺点**

适合处理字符数据，但如果内容本身包含了分隔符（字节数据常见情况），那么就会解析错误。

#### （4）声明长度

每条消息分为 head 和 body，定长的 head 中声明变长 body 的长度。有一定的开销，但综合性能和灵活性最好。

```java
public static void main(String[] args) {
    EmbeddedChannel channel = new EmbeddedChannel(
        // 参数1：最大长度
        // 参数2：长度域的偏移
        // 参数3：长度域占用字节
        // 参数4：长度域和数据域间隔
        // 参数5: 结果域的偏移
        new LengthFieldBasedFrameDecoder(1024, 1, 4, 1,6),
        new LoggingHandler(LogLevel.DEBUG)
    );

    //  4 个字节的内容长度， 实际内容
    ByteBuf buffer = ByteBufAllocator.DEFAULT.buffer();
    send(buffer, "Hello, world");
    send(buffer, "Hi!");
    channel.writeInbound(buffer);
}

private static void send(ByteBuf buffer, String content) {
    byte[] bytes = content.getBytes();
    int length = bytes.length;
    buffer.writeByte(1);
    buffer.writeInt(length);
    buffer.writeByte(1);
    buffer.writeBytes(bytes);
}
```

![LengthFieldBasedFrameDecoder](/image/jvm/jvm119.svg)

### 3、自定义协议 + 编解码器

接下来使用自定义协议 + 编解码器的方法解决粘包和半包问题，示例的原理是声明长度，不过可以自定义更加复杂的协议来进行实现，原理都是类似的。关键就是要**解决服务器端每次读取数据长度的问题**, 这个问题解决，就不会出现服务器多读或少读数据的问题，从而避免的 TCP 粘包、拆包 。

#### （1）协议包

```java
package com.ruyi.netty.protocoltcp;

/**
 * 协议包
 */
public class MessageProtocol {
    private int len;
    private byte[] content;

    public MessageProtocol() {
    }

    public MessageProtocol(int len, byte[] content) {
        this.len = len;
        this.content = content;
    }

    /**
     * 获取
     * @return len
     */
    public int getLen() {
        return len;
    }

    /**
     * 设置
     * @param len
     */
    public void setLen(int len) {
        this.len = len;
    }

    /**
     * 获取
     * @return content
     */
    public byte[] getContent() {
        return content;
    }

    /**
     * 设置
     * @param content
     */
    public void setContent(byte[] content) {
        this.content = content;
    }

}
```

#### （2）编码器

```java
package com.ruyi.netty.protocoltcp;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.MessageToByteEncoder;

public class MyMessageEncoder extends MessageToByteEncoder<MessageProtocol> {
    @Override
    protected void encode(ChannelHandlerContext ctx, MessageProtocol msg, ByteBuf out) throws Exception {
        System.out.println("MyMessageEncoder encode 方法被调用");
        out.writeInt(msg.getLen());
        out.writeBytes(msg.getContent());
    }
}
```

#### （3）解码器

```java
package com.ruyi.netty.protocoltcp;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ReplayingDecoder;
import java.util.List;

public class MyMessageDecoder extends ReplayingDecoder<Void> {
    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) throws Exception {
        System.out.println("MyMessageDecoder decode 方法被调用");

        int length = in.readInt();
        byte[] content = new byte[length];
        in.readBytes(content);
        //封装成 MessageProtocol
        MessageProtocol messageProtocol = new MessageProtocol(length, content);
        out.add(messageProtocol);
    }
}
```

#### （4）ServerHandler

```java
package com.ruyi.netty.protocoltcp;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.util.CharsetUtil;

import java.util.UUID;

public class MyServerHandler extends SimpleChannelInboundHandler<MessageProtocol> {

    private int count;

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        cause.printStackTrace();
        ctx.close();
    }

    @Override
    protected void channelRead0(ChannelHandlerContext channelHandlerContext, MessageProtocol msg) throws Exception {

        int len = msg.getLen();
        byte[] content = msg.getContent();
        System.out.println("服务器接收到消息如下：len=" + len + " content=" + new String(content, CharsetUtil.UTF_8));
        System.out.println("count=" + (++this.count));
    }
}
```

#### （5）ClientHandler

```java
package com.ruyi.netty.protocoltcp;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.util.CharsetUtil;

public class MyClientHandler extends SimpleChannelInboundHandler<MessageProtocol> {


    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {

        String mes = "hello七七";
        for (int i = 0; i < 10; i++) {
            byte[] content = mes.getBytes(CharsetUtil.UTF_8);
            int length = content.length;
            //创建协议包
            MessageProtocol messageProtocol = new MessageProtocol(length, content);
            ctx.writeAndFlush(messageProtocol);
        }
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, MessageProtocol msg) throws Exception {

    }
}

```



## 四、Netty源码分析

### 1、启动流程

Netty 说白了是对原始 Java-NIO 的二次开发和优化，因此底层还是 NIO 的开发范式。先回顾一下开发一个 NIO 服务器的基本步骤：

```java
// step 1. 创建 Selector
Selector selector = Selector.open();

// step 2. 创建 ssc，并配置非阻塞
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);

// ste 3. 关联 selector、ssc，并注册感兴趣事件
SelectionKey sscKey = ssc.register(selector, 0, null);

// step 4. 绑定端口
ssc.bind(new InetSocketAddress(8080));

// step 5. 注册感兴趣事件
sscKey.interestOps(SelectionKey.OP_ACCEPT);
```

然后跟踪源码，看看 Netty 是如何完成这几个步骤的。NioEventLoop 里面包含了 Selector 的开启，即NIO 的step 1，这个放到 NioEventLoop 中详细分析。下面的 group(), channel(), childHandler() 等方法都是配置 ServerBootstrap 的方法，关键逻辑在 bind() 方法里面。

```java
new ServerBootstrap()
    .group(new NioEventLoopGroup(1), new NioEventLoopGroup(2))
    .channel(NioServerSocketChannel.class)
    .childHandler(new ChannelInitializer<>() { ... })
    .bind(8080);
```

启动流程主要涉及两个线程: **Main 主线程**、**NioEventLoop 线程**。

![netty 启动流程](/image/jvm/jvm104.png)

ServerBootstrap 执行 bind，进入AbstractBootstrap#doBind方法

```java
//io.netty.bootstrap.AbstractBootstrap#doBind 
private ChannelFuture doBind(final SocketAddress localAddress) {
   			//进入 initAndRegister()
        final ChannelFuture regFuture = this.initAndRegister();
        final Channel channel = regFuture.channel();
        if (regFuture.cause() != null) {
            return regFuture;
        } else if (regFuture.isDone()) {
            ChannelPromise promise = channel.newPromise();
          //如果initAndRegister()执行完毕，直接调用doBind0
            doBind0(regFuture, channel, localAddress, promise);
            return promise;
        } else {
            final PendingRegistrationPromise promise = new PendingRegistrationPromise(channel);
            regFuture.addListener(new ChannelFutureListener() {
                public void operationComplete(ChannelFuture future) throws Exception {
                    Throwable cause = future.cause();
                    if (cause != null) {
                        promise.setFailure(cause);
                    } else {
                        promise.registered();
                        //如果initAndRegister()没有执行完毕，等待执行完毕后回调doBind0
                        AbstractBootstrap.doBind0(regFuture, channel, localAddress, promise);
                    }

                }
            });
            return promise;
        }
    }
```

进入 `initAndRegister()`后，里面分为 **init()** 和 **register()** 两个步骤。

```java
// io.netty.bootstrap.AbstractBootstrap#initAndRegister
channel = this.channelFactory.newChannel(); //创建NioServerSocketChannel  ----NIO step2

// io.netty.channel.socket.nio.NioServerSocketChannel#newSocket
private static ServerSocketChannel newSocket(SelectorProvider provider) {
    try {
        return provider.openServerSocketChannel();
    } catch (IOException e) {
        throw new ChannelException("Failed to open a server socket.", e);
    }
}
```

**Init()**

init 之前会创建 ServerSocketChannel，即NIO 的step 2。然后 init() 负责初始化通道的参数配置，并为 ServerSocketChannel 添加 ChannelInitializer ,准备执行（添加 ServerBootstrapAcceptor 处理子Channel，初始化的时候调用）

```java
//io.netty.bootstrap.ServerBootstrap#init()			
				// 为 NioServerSocketChannel 添加 ChannelInitializer
				p.addLast(new ChannelHandler[]{new ChannelInitializer<Channel>() {
          	//初始化的时候才会被调用
            public void initChannel(final Channel ch) throws Exception {
                final ChannelPipeline pipeline = ch.pipeline();
                ChannelHandler handler = ServerBootstrap.this.config.handler();
                if (handler != null) {
                    pipeline.addLast(new ChannelHandler[]{handler});
                }

                ch.eventLoop().execute(new Runnable() {
                    public void run() {
                      	//添加 ServerBootstrapAcceptor handler (accept 事件发生后建立连接)
                        //调用之后 pipeline 为 head -> ServerBootstrapAcceptor -> tail
                        pipeline.addLast(new ChannelHandler[]{new ServerBootstrapAcceptor(ch, currentChildGroup, currentChildHandler, currentChildOptions, currentChildAttrs)});
                    }
                });
            }
        }});
```

**register()**  	

开启一个新的NioEventLoop线程执行register0去关联 ssc 和 selector

```java
// io.netty.channel.AbstractChannel.AbstractUnsafe#register
  eventLoop.execute(new Runnable() {
      public void run() {
          AbstractUnsafe.this.register0(promise);
      }
  });
```

register0方法会调用AbstractNioChannel#doRegister关联 selector、ssc，并注册感兴趣事件，之后调用NioServerSocketChannel初始化handler，执行initChannel，最后给promise对象设置为成功

```java
//io.netty.channel.AbstractChannel.AbstractUnsafe#register0
    //调用AbstractNioChannel#doRegister关联 selector、ssc，并注册感兴趣事件
    AbstractChannel.this.doRegister();
    this.neverRegistered = false;
    AbstractChannel.this.registered = true;
    //调用NioServerSocketChannel初始化handler，执行initChannel
    AbstractChannel.this.pipeline.invokeHandlerAddedIfNeeded();
		//final ChannelFuture regFuture = this.initAndRegister()   regFuture == promise
		// 给promise对象设置为成功
    this.safeSetSuccess(promise);
    AbstractChannel.this.pipeline.fireChannelRegistered();
```

注意：register 方法的第三个参数是 attachment 附件，在 Netty 的实现里就是 NioServerSocketChannel

```java
// io.netty.channel.nio.AbstractNioChannel#doRegister
@Override
protected void doRegister() throws Exception {
    boolean selected = false;
    for (;;) {
        try {
            // NIO step3：关联 selector、ssc，并注册感兴趣事件
            selectionKey = javaChannel().register(eventLoop().unwrappedSelector(), 0, this);
            return;
        } catch (CancelledKeyException e) {
            if (!selected) {
                eventLoop().selectNow();
                selected = true;
            } else {
                throw e;
            }
        }
    }
}
```

**Bind**

promise对象设置为成功后会回调`AbstractBootstrap.doBind0`，层层调用最后到达 `AbstractChannel.AbstractUnsafe#bind`，首先调用`NioServerSocketChannel#doBind`方法绑定端口，之后触发所有handler的active事件注册感兴趣事件

```java
//io.netty.channel.AbstractChannel.AbstractUnsafe#bind
public final void bind(SocketAddress localAddress, ChannelPromise promise) {
          ......
          try {
            //NioServerSocketChannel#doBind
              AbstractChannel.this.doBind(localAddress);
          } catch (Throwable var5) {
              this.safeSetFailure(promise, var5);
              this.closeIfClosed();
              return;
          }

          if (!wasActive && AbstractChannel.this.isActive()) {
              this.invokeLater(new Runnable() {
                  public void run() {
                    //触发所有handler的active事件
                      AbstractChannel.this.pipeline.fireChannelActive();
                  }
              });
          }

          this.safeSetSuccess(promise);
      }
  }
```

`NioServerSocketChannel#doBind`方法

```java
// io.netty.channel.socket.nio.NioServerSocketChannel#doBind
@Override
protected void doBind(SocketAddress localAddress) throws Exception {
    if (PlatformDependent.javaVersion() >= 7) {
        // NIO step 4：绑定端口
        javaChannel().bind(localAddress, config.getBacklog());
    } else {
        javaChannel().socket().bind(localAddress, config.getBacklog());
    }
}
```

doBind 绑定完成后，会触发所有 handler 的 channelActive 方法，在 HeadContext 的 channelActive() 方法里会执行NIO step 5注册感兴趣事件，默认是关注`OP_ACCEPT`：

`HeadContext#channelActive`被触发

```java
# io.netty.channel.DefaultChannelPipeline.HeadContext#channelActive
public void channelActive(ChannelHandlerContext ctx) throws Exception {
    ctx.fireChannelActive();
    this.readIfIsAutoRead();
}
```

层层调用最后到达 `AbstractNioChannel#doBeginRead `

```java
//io.netty.channel.nio.AbstractNioChannel#doBeginRead    
protected void doBeginRead() throws Exception {
        SelectionKey selectionKey = this.selectionKey;
        if (selectionKey.isValid()) {
            this.readPending = true;
            int interestOps = selectionKey.interestOps();
          // readInterestOp = 16，即 SelectionKey.OP_ACCEPT
            if ((interestOps & this.readInterestOp) == 0) {
                selectionKey.interestOps(interestOps | this.readInterestOp);
            }
        }
    }
```

### 2、NioEventLoop

NioEventLoop 是 Netty 的一个核心类，包括很多重要的逻辑操作。

**成员对象**

1. 两个 Selector 对象

    - selector：基于数组存储 SelectionKey 实现的 Selector

    ```java
    // io.netty.channel.nio.SelectedSelectionKeySet
    SelectionKey[] keys = new SelectionKey[1024];
    ```

    - unwrappedSelector: 基于 HashSet 存储 SelectionKey 实现的 Selector，也即原始的 `java.nio.channels.Selector`

    ```java
    // sun.nio.ch.SelectorImpl
    private final Set<SelectionKey> selectedKeys;
    ```

    

2. 继承自 SingleThreadEventExecutor 的线程对象 thread 和所属的单线程 Executor

3. 暂存任务的任务队列，NioEventLoop 不仅可以处理 IO 事件，也可以处理普通任务和定时任务

    - `Queue<Runnable>`普通任务队列
    - `PriorityQueue<ScheduledFutureTask<?>>`定时任务

**构造方法**

NioEventLoop 内部使用 `unwrappedSelector` 进行底层的选择操作，而对外提供的接口是通过 `selector` 进行的，额外添加了处理空轮询问题、资源释放等功能，使得 Netty 能够提供更好的性能和稳定性。

```java
// io.netty.channel.nio.NioEventLoop#NioEventLoop
NioEventLoop(NioEventLoopGroup parent, Executor executor, SelectorProvider selectorProvider,
                SelectStrategy strategy, RejectedExecutionHandler rejectedExecutionHandler,
                EventLoopTaskQueueFactory queueFactory) {
    
    super(parent, executor, false, newTaskQueue(queueFactory), newTaskQueue(queueFactory), rejectedExecutionHandler);
    
    ...

    provider = selectorProvider;
  	//创建selector,魔改原始selector
    final SelectorTuple selectorTuple = openSelector();
    selector = selectorTuple.selector;
    unwrappedSelector = selectorTuple.unwrappedSelector;
    selectStrategy = strategy;
}


// io.netty.channel.nio.NioEventLoop#openSelector
private SelectorTuple openSelector() {
    try {
        // 此处即执行了 Java-NIO 的第1步，开启 Selector
        unwrappedSelector = provider.openSelector();
    } catch (IOException e) {
        throw new ChannelException("failed to open a new selector", e);
    }

    ...
}
```

**启动线程**

NioEventLoop 首次调用 execute() 时（事件触发）将启动 NIO 线程，并且通过状态变量保证只启动一次。

```java
// io.netty.util.concurrent.SingleThreadEventExecutor#doStartThread
private void doStartThread() {
    assert thread == null;
    executor.execute(new Runnable() {
        @Override
        public void run() {
            // thread 对象即 executor 线程池里的那个唯一线程
            thread = Thread.currentThread();

            ...

            try {
                // 进入死循环，监测普通任务、定时任务、IO事件
                SingleThreadEventExecutor.this.run();
            } catch (Throwable t) {
                ...
            }
        }
    });
}
```

**监听事件**

```java
// io.netty.channel.nio.NioEventLoop#run
@Override
protected void run() {
    for (;;) {
        // 选择策略：
        // 队列里没有任务时，走 SELECT 分支阻塞；
        // 队列里有任务时，则执行 selector.selectNow() 以非阻塞方式拿到所有 IO 事件
        switch (selectStrategy.calculateStrategy(selectNowSupplier, hasTasks())) {
            case SelectStrategy.CONTINUE:
                continue;

            case SelectStrategy.BUSY_WAIT:

            case SelectStrategy.SELECT:
            		//select方法
                select(wakenUp.getAndSet(false));
                if (wakenUp.get()) {
                    selector.wakeup();
                }
            default:
        }

        // 控制处理 IO 事件所占用的时间比例，默认50%
        final int ioRatio = this.ioRatio;
        // 处理 IO 事件
        processSelectedKeys();
        // 处理普通任务
        runAllTasks(ioTime * (100 - ioRatio) / ioRatio);
    }
}
```

**selectStrategy**

只有当有任务的时候才会走SELECT分支，否则会调用 selectNow() 方法，以非阻塞的方式拿到 IO 事件

```java
// io.netty.channel.DefaultSelectStrategy#calculateStrategy
public int calculateStrategy(IntSupplier selectSupplier, boolean hasTasks) throws Exception {
        return hasTasks ? selectSupplier.get() : -1;
    }

// io.netty.util.IntSupplier
private final IntSupplier selectNowSupplier = new IntSupplier() {
        public int get() throws Exception {
            return NioEventLoop.this.selectNow();
        }
    };
```

**select()方法**

使用selectCnt计数来解决nio空轮询bug(Linux下可能会出现),超过阈值（默认32）就会退出循环，重新创建新的selector

```java
//io.netty.channel.nio.NioEventLoop#select
private void select(boolean oldWakenUp) throws IOException {
        Selector selector = this.selector;

        try {
            int selectCnt = 0;
            long currentTimeNanos = System.nanoTime(); //currentTimeNanos当前时间
            // selectDeadLineNanos截止时间   this.delayNanos(currentTimeNanos)没有延时任务时为1s，否则为最晚延时任务到期时间
            long selectDeadLineNanos = currentTimeNanos + this.delayNanos(currentTimeNanos);

            while(true) {
              	// timeoutMillis 超时时间 = 截止时间-当前时间 + 0.5ms = 1s + 0.5ms
                long timeoutMillis = (selectDeadLineNanos - currentTimeNanos + 500000L) / 1000000L;
                if (timeoutMillis <= 0L) {
                    if (selectCnt == 0) {
                        selector.selectNow();
                        selectCnt = 1;
                    }
                    break;
                }

                if (this.hasTasks() && this.wakenUp.compareAndSet(false, true)) {
                    selector.selectNow();
                    selectCnt = 1;
                    break;
                }

                int selectedKeys = selector.select(timeoutMillis);
                ++selectCnt;
                if (selectedKeys != 0 || oldWakenUp || this.wakenUp.get() || this.hasTasks() || this.hasScheduledTasks()) {
                    break;
                }

                ...

                long time = System.nanoTime();
                if (time - TimeUnit.MILLISECONDS.toNanos(timeoutMillis) >= currentTimeNanos) {
                    selectCnt = 1;
                } else if (SELECTOR_AUTO_REBUILD_THRESHOLD > 0 && selectCnt >= SELECTOR_AUTO_REBUILD_THRESHOLD) {
                    logger.warn("Selector.select() returned prematurely {} times in a row; rebuilding Selector {}.", selectCnt, selector);
                    this.rebuildSelector();
                    selector = this.selector;
                    selector.selectNow();
                    selectCnt = 1;
                    break;
                }

                currentTimeNanos = time;
            }

            ...

    }
```

**wakeup方法**

wakeup方法可以用来唤醒阻塞的selector.select()方法，当提普通任务时会调用selector.wakeup方法唤醒selector

- `!inEventLoop` 表示只有其他线程提交的任务才会唤醒
- `wakenUp.compareAndSet(false, true)`  避免了多个线程同时调用wakeup方法

```java
//io.netty.channel.nio.NioEventLoop#wakeup
protected void wakeup(boolean inEventLoop) {
        if (!inEventLoop && this.wakenUp.compareAndSet(false, true)) {
            this.selector.wakeup();
        }
    }
```

**处理事件**

```java
// io.netty.channel.nio.NioEventLoop#processSelectedKey(java.nio.channels.SelectionKey, io.netty.channel.nio.AbstractNioChannel)
private void processSelectedKey(SelectionKey k, AbstractNioChannel ch) {
    final AbstractNioChannel.NioUnsafe unsafe = ch.unsafe();

    ...

    // 处理不同的 IO 事件
    int readyOps = k.readyOps();
    if ((readyOps & SelectionKey.OP_CONNECT) != 0) {
        int ops = k.interestOps();
        ops &= ~SelectionKey.OP_CONNECT;
        k.interestOps(ops);
        unsafe.finishConnect();
    }

    if ((readyOps & SelectionKey.OP_WRITE) != 0) {
        ch.unsafe().forceFlush();
    }

    if ((readyOps & (SelectionKey.OP_READ | SelectionKey.OP_ACCEPT)) != 0 || readyOps == 0) {
        unsafe.read();
    }
}
```

**处理 ACCEPT 事件**

执行 `unsafe.read()` 后，接受连接，创建 SocketChannel 后执行 handler 链。

```java
// io.netty.channel.nio.AbstractNioMessageChannel.NioMessageUnsafe#read

public void read() {
    do {
        // 处理 accept，创建 NioSocketChannel
        int localRead = doReadMessages(readBuf);
        ...
    } while (allocHandle.continueReading());
    
    int size = readBuf.size();
    for (int i = 0; i < size; i ++) {
        readPending = false;
        // 开始调用 handler 链的 channelRead 方法
        pipeline.fireChannelRead(readBuf.get(i));
    }
    ...
    allocHandle.readComplete();
    pipeline.fireChannelReadComplete();
}


// io.netty.channel.socket.nio.NioServerSocketChannel#doReadMessages
protected int doReadMessages(List<Object> buf) throws Exception {
    // 此处即执行 ssc.accept(),创建 SocketChannel
    SocketChannel ch = SocketUtils.accept(javaChannel());
    if (ch != null) {
        buf.add(new NioSocketChannel(this, ch));
        return 1;
    }
   
    ...
    return 0;
}
```

ServerSocketChannel 的调用链是 **head -> ServerBootstrapAcceptor -> tail**，由 acceptor 负责处理连接的 accpt 事件，执行和 ServerSocketChannel 类似的 register 流程（启动流程步骤-2）。只不过这次是 SocketChannel 的启动，也是要新建 NIO 线程，为 SocketChannel 执行用户自定义的 ChannelInitializer。

```java
// io.netty.bootstrap.ServerBootstrap.ServerBootstrapAcceptor#channelRead
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    final Channel child = (Channel) msg;
    child.pipeline().addLast(childHandler);

    try {
        // 注册流程，和启动流程类似
        childGroup.register(child).addListener(new ChannelFutureListener() {
            @Override
            public void operationComplete(ChannelFuture future) throws Exception {
                if (!future.isSuccess()) {
                    forceClose(child, future.cause());
                }
            }
        });
    } catch (Throwable t) {
        forceClose(child, t);
    }
}
```

完成后触发`pipeline.fireChannelActive()`注册 read 事件（启动流程步骤-4），结束 Accpet 事件的处理。

**处理 READ 事件**

同样的，触发 read 事件后，读取数据最后交由 Pipeline 里面用户自定义的各个 Handler 依次加工数据，完成 Read 事件处理。

```java
// io.netty.channel.nio.AbstractNioByteChannel.NioByteUnsafe#read
public final void read() {

    ...

    ByteBuf byteBuf = null;
    do {
        byteBuf = allocHandle.allocate(allocator);
        // 基于底层 Java-NIO，将数据读入 byteBuf
        allocHandle.lastBytesRead(doReadBytes(byteBuf));
        
        ...

        // 依次经过各个 Handler 加工
        pipeline.fireChannelRead(byteBuf);
        byteBuf = null;
    } while (allocHandle.continueReading());

    allocHandle.readComplete();
    pipeline.fireChannelReadComplete();
}
```
