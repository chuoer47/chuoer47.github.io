---
title: Netty基础
date: 2024-11-06 16:24:22
tags: 网络编程
order: 21
---



# Netty基础

Netty 是一个基于 NIO 的异步网络编程框架，基于 Netty 能快速的搭建高性能易扩展的网络应用（包括客户端与服务端）[官方网址](https://netty.io/)

## 一、Netty概述

### 1、原生NIO存在的问题

- 1、NIO 的类库和 API 繁杂，使用麻烦：需要熟练掌握 Selector、ServerSocketChannel、SocketChannel、ByteBuffer
    等。

- 2、需要具备其他的额外技能：要熟悉 Java 多线程编程，因为 NIO 编程涉及到 Reactor 模式，你必须对多线程
    和网络编程非常熟悉，才能编写出高质量的 NIO 程序。

- 3、开发工作量和难度都非常大：例如客户端面临断连重连、网络闪断、半包读写、失败缓存、网络拥塞和异常流
    的处理等等。

- 4、JDK NIO 的 Bug：例如臭名昭著的 Epoll Bug，它会导致 Selector 空轮询，最终导致 CPU 100%。直到 JDK 1.7
    版本该问题仍旧存在，没有被根本解决。

### 2、Netty的优点

Netty 对 JDK 自带的 NIO 的 API 进行了封装，解决了上述问题。

- 1、设计优雅：适用于各种传输类型的统一 API 阻塞和非阻塞 Socket；基于灵活且可扩展的事件模型，可以清晰
    地分离关注点；高度可定制的线程模型 - 单线程，一个或多个线程池.

- 2、使用方便：详细记录的 Javadoc，用户指南和示例；没有其他依赖项，JDK 5（Netty 3.x）或 6（Netty 4.x）就
    足够了。

- 3、高性能、吞吐量更高：延迟更低；减少资源消耗；最小化不必要的内存复制。

- 4、安全：完整的 SSL/TLS 和 StartTLS 支持。

- 5、社区活跃、不断更新：社区活跃，版本迭代周期短，发现的 Bug 可以被及时修复，同时，更多的新功能会被
    加入

### 3、Netty版本说明

- 1、netty 版本分为 netty3.x 和 netty4.x、netty5.x

- 2、因为 Netty5 出现重大 bug，已经被官网废弃了，目前推荐使用的是 Netty4.x 的稳定版本

- 3、目前在官网可下载的版本 netty3.x netty4.0.x 和 netty4.1.x

- 4、netty [下载地址]( https://bintray.com/netty/downloads/netty/)

## 二、Netty高性能架构设计

### 1、线程模型介绍

不同的线程模式，对程序的性能有很大影响，为了搞清 Netty 线程模式，我们来系统的讲解下 各个线程模式，最后看看 Netty 线程模型有什么优越性。
- 目前存在的线程模型有：传统阻塞 I/O 服务模型、Reactor 模式

- 根据 Reactor 的数量和处理资源池线程的数量不同，有 3 种典型的实现：单 Reactor 单线程、单 Reactor 多线程、主从 Reactor 多线程
- Netty 主要基于主从 Reactor 多线程模型做了一定的改进，其中主从 Reactor 多线程模型有多个 Reactor

### 2、传统阻塞 I/O 服务模型

![](/image/jvm/jvm105.png)

**特点：**

- 1、采用阻塞 IO 模式获取输入的数据

- 2、每个连接都需要独立的线程完成数据的输入，业务处理，数据返回

**存在问题：**

- 1、当并发数很大，就会创建大量的线程，占用很大系统资源

- 2、连接创建后，如果当前线程暂时没有数据可读，该线程会阻塞在 read 操作，造成线程资源浪费

### 3、Reactor模式

- 基于 I/O 复用模型：多个连接共用一个阻塞对象，应用程序只需要在一个阻塞对象等待，无需阻塞等待所有连接。当某个连接有新的数据可以处理时，操作系统通知应用程序，线程从阻塞状态返回，开始进行业务处理，Reactor 对应的叫法: 1. 反应器模式 2. 分发者模式(Dispatcher) 3. 通知者模式(notifier)
- 基于线程池复用线程资源：不必再为每个连接创建线程，将连接完成后的业务处理任务分配给线程进行处理，一个线程可以处理多个连接的业务。

![](/image/jvm/jvm106.png)

**1）说明：**

- 1、Reactor 模式，通过一个或多个输入同时传递给服务处理器的模式(基于事件驱动)

- 2、服务器端程序处理传入的多个请求,并将它们同步分派到相应的处理线程， 因此 Reactor 模式也叫 Dispatcher
    模式

- 3、Reactor 模式使用 IO 复用监听事件, 收到事件后，分发给某个线程(进程), 这点就是网络服务器高并发处理关键

**2）组成：**

- 1、Reactor：Reactor 在一个单独的线程中运行，负责监听和分发事件，分发给适当的处理程序来对 IO 事件做出反应。 它就像公司的电话接线员，它接听来自客户的电话并将线路转移到适当的联系人；

- 2、Handlers：处理程序执行 I/O 事件要完成的实际事件，类似于客户想要与之交谈的公司中的实际官员。Reactor通过调度适当的处理程序来响应 I/O 事件，处理程序执行非阻塞操作。

**3）Reactor 模式分类：**
根据 Reactor 的数量和处理资源池线程的数量不同，有 3 种典型的实现

- 1、单 Reactor 单线程

- 2、单 Reactor 多线程

- 3、主从 Reactor 多线程

**4）Reactor 模式具有如下的优点：**

- 1、响应快，不必为单个同步时间所阻塞，虽然 Reactor 本身依然是同步的

- 2、可以最大程度的避免复杂的多线程及同步问题，并且避免了多线程/进程的切换开销

- 3、扩展性好，可以方便的通过增加 Reactor 实例个数来充分利用 CPU 资源

- 4、复用性好，Reactor 模型本身与具体事件处理逻辑无关，具有很高的复用性

### 4、Netty模型

![Netty Reactor 工作架构图](/image/jvm/jvm107.png)

- 1、Netty 抽象出两组线程池 BossGroup 专门负责接收客户端的连接, WorkerGroup 专门负责网络的读写

- 2、BossGroup 和 WorkerGroup 类型都是 NioEventLoopGroup

- 3、NioEventLoopGroup 相当于一个事件循环组, 这个组中含有多个事件循环 ，每一个事件循环是 NioEventLoop

- 4、NioEventLoop 表示一个不断循环的执行处理任务的线程， 每个 NioEventLoop 都有一个 selector , 用于监听绑定在其上的 socket 的网络通讯

- 5、NioEventLoopGroup 可以有多个线程, 即可以含有多个 NioEventLoop

- 6、每个 Boss NioEventLoop 循环执行的步骤有 3 步
    - （1）轮询 accept 事件
    - （2）处理 accept 事件 , 与 client 建立连接 , 生成 NioScocketChannel , 并将其注册到某个 worker NIOEventLoop 上的 selector
    - （3）处理任务队列的任务 ， 即 runAllTasks

- 7、每个 Worker NIOEventLoop 循环执行的步骤
    - （1）轮询 read, write 事件
    - （2）处理 i/o 事件， 即 read , write 事件，在对应 NioScocketChannel 处理
    - （3）处理任务队列的任务 ， 即 runAllTasks

- 8、每个 Worker NIOEventLoop 处理业务时，会使用 pipeline(管道), pipeline 中包含了 channel , 即通过 pipeline可以获取到对应通道, 管道中维护了很多的 处理器

### 5、使用示例

#### 1、Server

```java
package com.ruyi.netty.simple;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;

public class NettyServerDemo1 {
    public static void main(String[] args) throws InterruptedException {

        //创建BossGroup 和 Workgroup
        //说明：
        //1、创建两个线程组 bossGroup 和 workerGroup
        //2、 bossGroup 只是处理连接请求，真正和客户端业务处理会交给 workerGroup处理
        //3、两个都是无限循环
        EventLoopGroup boosGroup = new NioEventLoopGroup();
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        try {
            //创建服务器端启动对象，配置参数
            ServerBootstrap bootstrap = new ServerBootstrap();
            bootstrap.group(boosGroup, workerGroup) //设置两个线程组
                    .channel(NioServerSocketChannel.class) //使用 NioServerSocketChannel 作为服务器通道实现
                    .option(ChannelOption.SO_BACKLOG, 128) //设置线程队列得到的连接个数
                    .childOption(ChannelOption.SO_KEEPALIVE, true) //设置保持活动连接状态
                    .childHandler(new ChannelInitializer<SocketChannel>() {//创建一个通道初始化对象
                        //给pipeline设置处理器
                        @Override
                        protected void initChannel(SocketChannel ch) throws Exception {
                            ch.pipeline().addLast(new NettyServerHandler1());

                        }
                    }); //给 WorkerGroup 的 Eventloop 对应的管道设置处理器

            System.out.println("...server is ready...");

            //绑定一个端口并同步,生成一个 ChannelFuture 对象
            //启动服务器
            ChannelFuture cf = bootstrap.bind(6666).sync();

            cf.addListener(new ChannelFutureListener() {
                @Override
                public void operationComplete(ChannelFuture channelFuture) throws Exception {
                    if(channelFuture.isSuccess()){
                        System.out.println("监听端口成功");
                    }else {
                        System.out.println("监听端口失败");
                    }
                }
            });

            //对关闭通道进行监听
            cf.channel().closeFuture().sync();
        } finally {
            boosGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }

    }
}

```

#### 2、ServerHandler

```java
package com.ruyi.netty.simple;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.util.CharsetUtil;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * 自定义一个Handler，需要继承netty规定好的某个 HandlerAdapter
 */
public class NettyServerHandler1 extends ChannelInboundHandlerAdapter {

    //读取数据事件，可以读取客户端发送的消息
    /**
     * 1、ChannelHandlerContext ctx 上下文对象含有 管道pipeline， 通道channel ，地址
     * 2、Object msg 客户端发过来的数据
     * @param ctx
     * @param msg
     * @throws Exception
     */
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        System.out.println("server ctx = " + ctx );
        //将msg 转成一个ByteBuf
        ByteBuf buf = (ByteBuf) msg;
        System.out.println("client send:" + buf.toString(CharsetUtil.UTF_8));
        System.out.println("client address:" + ctx.channel().remoteAddress());

        //如果有一个耗时非常久的任务，可以异步执行，提交到channel对应的NIOEventloop的taskQueue中
//        Thread.sleep(10 * 1000);
//        ctx.writeAndFlush(Unpooled.copiedBuffer("hello client 222222222222", CharsetUtil.UTF_8));
        ctx.channel().eventLoop().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Thread.sleep(10 * 1000);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
                ctx.writeAndFlush(Unpooled.copiedBuffer("hello client 222222222222", CharsetUtil.UTF_8));
            }
        });

        //2、用户自定义定时任务->提交到scheduleTaskQueue中
        ctx.channel().eventLoop().schedule(new Runnable() {
            @Override
            public void run() {
                try {
                    Thread.sleep(5 * 1000);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
                ctx.writeAndFlush(Unpooled.copiedBuffer("hello client 444444444444", CharsetUtil.UTF_8));
            }
        }, 5 , TimeUnit.SECONDS);

    }

    //数据读取完毕之后
    @Override
    public void channelReadComplete(ChannelHandlerContext ctx) throws Exception {
        //将数据写入缓存并刷新
        ctx.writeAndFlush(Unpooled.copiedBuffer("hello client", CharsetUtil.UTF_8));
    }

    //处理异常，一般是关闭通道
    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        ctx.close();
    }
}

```

#### 3、Client

```java
package com.ruyi.netty.simple;

import io.netty.bootstrap.Bootstrap;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioSocketChannel;

public class NettyClientDemo1 {
    public static void main(String[] args) throws InterruptedException {

        //客户端只需要一个事件循环组
        EventLoopGroup group = new NioEventLoopGroup();

        try {
            //客户端启动对象
            Bootstrap bootstrap = new Bootstrap();

            bootstrap.group(group)
                    .channel(NioSocketChannel.class)
                    .handler(new ChannelInitializer<SocketChannel>() {
                        @Override
                        protected void initChannel(SocketChannel ch) throws Exception {
                            ch.pipeline().addLast(new NettyClientHandler1());
                        }
                    });

            System.out.println("... client is ok...");

            //启动客户端连接服务器端
            ChannelFuture cf = bootstrap.connect("127.0.0.1", 9999).sync();

            cf.channel().closeFuture().sync();
        } finally {
            group.shutdownGracefully();
        }
    }
}

```

4、CilentHandler

```java
package com.ruyi.netty.simple;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.util.CharsetUtil;

public class NettyClientHandler1 extends ChannelInboundHandlerAdapter {
    //当通道就绪就会触发
    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        System.out.println("client ctx = " + ctx);
        ctx.writeAndFlush(Unpooled.copiedBuffer("喵～", CharsetUtil.UTF_8));
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {

        //将msg 转成一个ByteBuf
        ByteBuf buf = (ByteBuf) msg;
        System.out.println("server send:" + buf.toString(CharsetUtil.UTF_8));
        System.out.println("server address:" + ctx.channel().remoteAddress());
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        cause.printStackTrace();
        ctx.close();
    }
}

```

### 6、Future-Listener 机制

- 当 Future 对象刚刚创建时，处于非完成状态，调用者可以通过返回的 ChannelFuture 来获取操作执行的状态，注册监听函数来执行完成后的操作。

- 常见有如下操作
    - 1、通过 `isDone` 方法来判断当前操作是否完成；
    - 2、通过 `isSuccess` 方法来判断已完成的当前操作是否成功；
    - 3、通过 `getCause` 方法来获取已完成的当前操作失败的原因；
    - 4、通过 `isCancelled` 方法来判断已完成的当前操作是否被取消；
    - 5、通过 `addListener `方法来注册监听器，当操作已完成(isDone 方法返回完成)，将会通知指定的监听器；
    - 6、如果`Future `对象已完成，则通知指定的监听器

## 三、Netty核心模块组件

### 1、Bootstrap、ServerBootstrap

Bootstrap 意思是引导，一个 Netty 应用通常由一个 Bootstrap 开始，主要作用是配置整个 Netty 程序，串联各个组件，Netty 中 Bootstrap 类是客户端程序的启动引导类，ServerBootstrap 是服务端启动引导类

**常见的方法有**

- `public ServerBootstrap group(EventLoopGroup parentGroup, EventLoopGroup childGroup)`，该方法用于服务器端，用来设置两个 EventLoop

- `public B group(EventLoopGroup group) `，该方法用于客户端，用来设置一个 EventLoop

- `public B channel(Class<? extends C> channelClass)`，该方法用来设置一个服务器端的通道实现

- `public <T> B option(ChannelOption<T> option, T value)`，用来给 ServerChannel 添加配置

- `public <T> ServerBootstrap childOption(ChannelOption<T> childOption, T value)`，用来给接收到的通道添加配置
- `public ServerBootstrap childHandler(ChannelHandler childHandler) `， 该 方 法 用 来 设 置业 务 处 理 类 （ 自 定 义 的handler）
- `public ChannelFuture bind(int inetPort)` ，该方法用于服务器端，用来设置占用的端口号
- `public ChannelFuture connect(String inetHost, int inetPort)` ，该方法用于客户端，用来连接服务器端

### 2、Future、ChannelFuture

Netty 中所有的 IO 操作都是异步的，不能立刻得知消息是否被正确处理。但是可以过一会等它执行完成或者直接注册一个监听，具体的实现就是通过 Future 和 ChannelFutures，他们可以注册一个监听，当操作执行成功或失败时监听会自动触发注册的监听事件

常见的方法有：

- `Channel channel()`，返回当前正在进行 IO 操作的通道
- `ChannelFuture sync()`，等待异步操作执行完毕

### 3、Channel

- 1、Netty 网络通信的组件，能够用于执行网络 I/O 操作。
- 2、通过 Channel 可获得当前网络连接的通道的状态
- 3、通过 Channel 可获得 网络连接的配置参数 （例如接收缓冲区大小）
- 4、Channel 提供异步的网络 I/O 操作(如建立连接，读写，绑定端口)，异步调用意味着任何 I/O 调用都将立即返回，并且不保证在调用结束时所请求的 I/O 操作已完成
- 5、调用立即返回一个 ChannelFuture 实例，通过注册监听器到 ChannelFuture 上，可以 I/O 操作成功、失败或取消时回调通知调用方
- 6、支持关联 I/O 操作与对应的处理程序
- 7、不同协议、不同的阻塞类型的连接都有不同的 Channel 类型与之对应，常用的 Channel 类型:
    - NioSocketChannel，异步的客户端 TCP Socket 连接。
    - NioServerSocketChannel，异步的服务器端 TCP Socket 连接。
    - NioDatagramChannel，异步的 UDP 连接。
    - NioSctpChannel，异步的客户端 Sctp 连接。
    - NioSctpServerChannel，异步的 Sctp 服务器端连接，这些通道涵盖了 UDP 和 TCP 网络 IO 以及文件 IO。

### 4、Selector

- 1、Netty 基于 Selector 对象实现 I/O 多路复用，通过 Selector 一个线程可以监听多个连接的 Channel 事件。
- 2、当向一个 Selector 中注册 Channel 后，Selector 内部的机制就可以自动不断地查询(Select) 这些注册的Channel 是否有已就绪的 I/O 事件（例如可读，可写，网络连接完成等），这样程序就可以很简单地使用一个线程高效地管理多个 Channel

### 5、ChannelHandler 及其实现类

- 1、ChannelHandler 是一个接口，处理 I/O 事件或拦截 I/O 操作，并将其转发到其 ChannelPipeline(业务处理链)中的下一个处理程序。
- 2、ChannelHandler 本身并没有提供很多方法，因为这个接口有许多的方法需要实现，方便使用期间，可以继承它的子类

- 3、ChannelHandler 及其实现类一览图
- 4、我们经常需要自定义一个 Handler 类去继承 ChannelInboundHandlerAdapter，然后通过重写相应方法实现业务逻辑
    - `ChannelActive` 通道就绪
    - `ChannelRead` 通道读取事件

![Channel 相关接口一览图](/image/jvm/jvm108.png)

### 6、Pipeline 和 ChannelPipeline

ChannelPipeline 是一个重点：

- 1、ChannelPipeline 是一个 Handler 的集合，它负责处理和拦截 inbound 或者 outbound 的事件和操作，相当于一个贯穿 Netty 的链。(也可以这样理解：ChannelPipeline 是 保存 ChannelHandler 的 List，用于处理或拦截Channel 的入站事件和出站操作)

- 2、ChannelPipeline 实现了一种高级形式的拦截过滤器模式，使用户可以完全控制事件的处理方式，以及 Channel中各个的 ChannelHandler 如何相互交互
- 3、在 Netty 中每个 Channel 都有且仅有一个 ChannelPipeline 与之对应，它们的组成关系如下

![](/image/jvm/jvm109.png)

- 一个 Channel 包含了一个 ChannelPipeline，而 ChannelPipeline 中又维护了一个由 ChannelHandlerContext组成的双向链表，并且每个 ChannelHandlerContext 中又关联着一个 ChannelHandler
-  入站事件和出站事件在一个双向链表中，入站事件会从链表 head往后传递到最后一个入站的 handler，出站事件会从链表tail 往前传递到最前一个出站的handler，两种类型的handler 互不干扰

### 7、ChannelHandlerContext

- 保存 Channel 相关的所有上下文信息，同时关联一个 ChannelHandler 对象
- 即 ChannelHandlerContext 中 包 含 一 个 具 体 的 事 件 处 理 器 ChannelHandler ， 同 时ChannelHandlerContext 中也绑定了对应的 pipeline 和 Channel 的信息，方便对 ChannelHandler 进行调用.

### 8、ChannelOption

Netty 在创建 Channel 实例后,一般都需要设置 ChannelOption 参数。

ChannelOption 参数如下:

- 1、`ChannelOption.SO_BACKLOG`  对应TCP/IP 协议 listen 函数中的 backlog参数，用来初始化服务器可连接队列大小。服务端处理客户端连接请求是顺序处理的，所以同一时间只能处理一个客户端连接。多个客户端来的时候，服务端将不能处理的客户端连接请求放在队列中等待处理，backlog 参数指定
    了队列的大小。
- 2、`ChannelOption.SO_KEEPALIVE`  一直保持连接活动状态
- 3、`ChannelOption.CONNECT_TIMEOUT_MILLIS` 用在客户端建立连接时，如果在指定毫秒内无法连接，会抛出 timeout 异常
- 4、`ChannelOption.TCP_NODELAY` 
- 属于 SocketChannal 参数，是 TCP 协议的一个选项，用于是否禁用 Nagle 算法。开启 Nagle 能够减少网络中小分组的数量，提高网络的效率，但实时性较差。关闭 Nagle 可以尽快发出数据包，降低延迟，适合实时游戏、视频通话等需要即时响应的场景。

### 9、ByteBuf

ByteBuf 是 Netty 提供的用于处理字节数据的缓冲区类，是 Netty 的核心组件之一。提供了丰富的 API，用于操作字节数据，包括读取、写入、复制、切片等操作。

**1）特点**

- 灵活的内存分配：ByteBuf 支持自动扩容，并且使用池化技术分配内存，避免频繁地创建和销毁缓冲区，提高了内存利用率
- 零拷贝：ByteBuf 支持零拷贝技术，可以直接访问 OS 底层数据，避免了数据在应用程序和内核空间之间的复制
- 读写索引分离：ByteBuf 有独立的读索引和写索引，可以实现零拷贝的同时保持读写操作的独立性
- 引用计数：ByteBuf 使用引用计数来跟踪缓冲区的引用次数，当引用计数为零时将被自动释放，避免了内存泄漏
- 可组合和复合：ByteBuf 可以被组合成更大的数据结构，也可以被拆分成多个小的数据结构，支持复杂的数据处理需求

**2）创建**

Netty 创建的 ByteBuf 既可以使用直接内存，也可以使用堆内存，并且默认开启了池化技术。

```java
// 默认使用直接内存
ByteBuf directBuf1 = ByteBufAllocator.DEFAULT.buffer();
System.out.println(directBuf1.getClass());

// 默认方法实际调用的这一层
ByteBuf directBuffer2 = ByteBufAllocator.DEFAULT.directBuffer();
System.out.println(directBuffer2.getClass());

// 指定使用堆内存
ByteBuf heapBuffer = ByteBufAllocator.DEFAULT.heapBuffer();
System.out.println(heapBuffer.getClass());

// Handler 中可以使用 context 创建
ByteBuf buf = channelHandlerContext.alloc().buffer();
```

**直接内存 vs 堆内存**

- 直接内存创建和销毁的代价昂贵，但读写性能高（少一次内存复制），适合配合池化功能一起用
- 直接内存对 GC 压力小，因为这部分内存不受 JVM 垃圾回收的管理，但也要注意及时主动释放

**池化 vs 非池化**

- 没有池化，则每次都要创建新的 ByteBuf 实例，这个操作对直接内存代价昂贵，就算是堆内存，也会增加 GC 压力
- 有了池化，则可以重用池中 ByteBuf 实例，并且采用了与 jemalloc 类似的内存分配算法提升分配效率
- 高并发时，池化功能更节约内存，减少内存溢出的可能

在 Netty 4.1 版本之后，除了 Android 平台默认实现都是开启池化的，可以通过环境变量/VM参数指定是否池化：`-Dio.netty.allocator.type={unpooled|pooled}`

**3）结构**

ByteBuf 的内存区域可以分为四个部分，通过若干个索引分割：

![ByteBuf结构](/image/jvm/jvm110.png)

最开始读写指针都在 0 位置

1. Reader Index 读索引： readerIndex 是一个指针，表示下一个被读取的字节的位置。从 ByteBuf 中读取数据时，readerIndex 会随之移动。可以通过`byteBuf.readerIndex()`获取。
2. Writer Index 写索引： writerIndex 是一个指针，表示下一个可以被写入数据的位置。向 ByteBuf 中写入数据时，writerIndex 会随之移动。可以通过`byteBuf.writerIndex()`获取。
3. Capacity 容量： capacity 表示 ByteBuf 的总容量，即它可以存储的最大字节数。当 writerIndex 达到 capacity 时，ByteBuf 需要重新分配更大的内存来扩容。可以通过`byteBuf.capacity()`获取。
4. Max Capacity 最大容量： maxCapacity 是 ByteBuf 的最大容量，即它能够动态扩容的最大限制。默认是 Integer.MAX_VALUE，可以通过`byteBuf.maxCapacity()`获取。
5. Reference Count 引用计数： ByteBuf 使用引用计数来跟踪缓冲区的引用次数。当引用计数为零时，ByteBuf 内存将被释放。基于 ReferenceCounted 接口实现，可以通过`byteBuf.refCnt()`获取

**4）读写**

写方法，写指针会随写入字节数移动；类似的有对应的读方法(write->read)，读指针随读取字节数移动。

| 方法签名                                                     | 含义                   | 备注                                        |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------- |
| writeBoolean(boolean value)                                  | 写入 boolean 值        | 用一字节 01\|00 代表 true\|false            |
| writeByte(int value)                                         | 写入 byte 值           |                                             |
| writeShort(int value)                                        | 写入 short 值          |                                             |
| writeInt(int value)                                          | 写入 int 值            | Big Endian，即 0x250，写入后 00 00 02 50    |
| writeIntLE(int value)                                        | 写入 int 值            | Little Endian，即 0x250，写入后 50 02 00 00 |
| writeLong(long value)                                        | 写入 long 值           |                                             |
| writeChar(int value)                                         | 写入 char 值           |                                             |
| writeFloat(float value)                                      | 写入 float 值          |                                             |
| writeDouble(double value)                                    | 写入 double 值         |                                             |
| writeBytes(ByteBuf src)                                      | 写入 netty 的 ByteBuf  |                                             |
| writeBytes(byte[] src)                                       | 写入 byte[]            |                                             |
| writeBytes(ByteBuffer src)                                   | 写入 nio 的 ByteBuffer |                                             |
| int writeCharSequence(CharSequence sequence, Charset charset) | 写入字符串             |                                             |

提示

- 未指明返回值的写方法，其返回值都是 this，因此支持链式调用
- 一系列以 set 开头的写方法可以修改指定位置的数据，不改变写指针位置
- 一系列以 get 开头的读方法可以读取指定位置的数据，不改变读指针位置
- 类似 NIO 的 ByteBuffer，`byteBuf.mark[Writer|Reader]Index`、`byteBuf.reset[Writer|Reader]Index`可以标记、重置读写指针
- 网络传输，默认习惯是 Big Endian

**5）扩容机制**

- 如果写入后数据大小未超过 4MB，则每次容量翻倍
- 如果写入后数据大小超过 4MB，则每次增加 $4MB * n$，$n$ 取决于容量足够即可，目的是避免内存浪费
- 扩容的大小不能超过 max capacity

**6）内存回收**

基于堆外内存的 ByteBuf 实现最好是手动来释放，而不是等 GC 垃圾回收。

- UnpooledHeapByteBuf 使用 JVM 内存，只需等 GC 回收内存即可
- UnpooledDirectByteBuf 使用直接内存，需要特殊的方法来回收内存
- PooledByteBuf 及其子类使用了池化机制，需要更复杂的规则来回收内存

回收内存的源码实现，可以关注 `protected abstract void deallocate()`方法的不同实现。

原理上，Netty 采用了引用计数法来控制回收内存，每种 ByteBuf 都实现了 ReferenceCounted 接口：

- 每个 ByteBuf 对象的初始计数为 1
- 调用 `byteBuf.release()` 方法计数减 1
- 调用 `byteBuf.retain()` 方法计数加 1
- 当计数为 0 时，底层内存会被回收，这时即使 ByteBuf 对象还在，其各个方法均无法正常使用

**释放规则**

基本规则是，**谁是最后使用者，谁负责 release ！**

- 起点，对于 NIO 实现来讲，在 io.netty.channel.nio.AbstractNioByteChannel.NioByteUnsafe#read 方法中首次创建 ByteBuf 放入 pipeline（line 163 pipeline.fireChannelRead(byteBuf)）
- 入站 ByteBuf 处理原则
    - 对原始 ByteBuf 不做处理，调用 ctx.fireChannelRead(msg) 向后传递，这时无须 release
    - 将原始 ByteBuf 转换为其它类型的 Java 对象，这时 ByteBuf 就没用了，必须 release
    - 如果不调用 ctx.fireChannelRead(msg) 向后传递，那么也必须 release
    - 注意各种异常，如果 ByteBuf 没有成功传递到下一个 ChannelHandler，必须 release
    - 假设消息一直向后传，那么 TailContext 会负责释放未处理消息（原始的 ByteBuf）
- 出站 ByteBuf 处理原则
    - 出站消息最终都会转为 ByteBuf 输出，一直向前传，由 HeadContext flush 后 release
- 异常处理原则
    - 有时候不清楚 ByteBuf 被引用了多少次，但又必须彻底释放，可以循环调用 release 直到返回 true

**7）零拷贝**

和 OS 里面的零拷贝意义略有不同，Netty 的零拷贝指的是对 ByteBuf 的复制、拼接在底层没有发生内存的拷贝，还是使用原来的那块内存区域，只不过新增了一些指针来维护不同的实例。

**切片**

`byteBuf.slice()`对 ByteBuf 进行切片，并不发生内存复制，切片后的多个 ByteBuf 各自维护独立的 read，write 指针。

![ByteBuf切片](/image/jvm/jvm111.png)

```java
ByteBuf buf = ByteBufAllocator.DEFAULT.buffer(10);
buf.writeBytes(new byte[]{'a','b','c','d','e','f','g','h','i','j'});
log(buf);

// 切片后调用 retain 防止被释放
ByteBuf slice = buf.slice(0, 5);
slice.retain();
// 对 slice 写数据也会改变原来的 buf，因为底层是同一块内存区域
slice.setByte(4, 'x');
log(slice);

// 使用完毕要注意主动释放
slice.release();
```

**复制**

`byteBuf.duplicate()`截取原始 ByteBuf 的所有内容，不发生内存拷贝，仅新增维护指针。

![ByteBuf复制](/image/jvm/jvm112.png)

`byteBuf.copy()`则是执行了深拷贝，无论读写都和原 ByteBuf 无关。

**组合**

CompositeByteBuf 是一个组合的 ByteBuf，内部维护了一个 Component 数组，每个 Component 管理一个 ByteBuf，记录了这个 ByteBuf 相对于整体偏移量的信息，代表着整体中某一段的数据。

- 优点，对外是一个虚拟视图，组合这些 ByteBuf 不会产生内存复制
- 缺点，复杂了很多，多次操作会带来性能的损耗

```java
CompositeByteBuf buffer = ByteBufAllocator.DEFAULT.compositeBuffer();
buffer.addComponents(true, buf1, buf2);
log(buffer);
```

**8）Unpooled**

Unpooled 是一个工具类，提供了非池化的 ByteBuf 创建、组合、复制等操作，例如`wrappedBuffer`用于包装 ByteBuf，并且底层不会发生拷贝。

```java
// 当包装 ByteBuf 个数超过一个时, 底层使用了 CompositeByteBuf
ByteBuf buf3 = Unpooled.wrappedBuffer(buf1, buf2);

// 也可以包装普通字节数组
ByteBuf buf4 = Unpooled.wrappedBuffer(new byte[]{1, 2, 3}, new byte[]{4, 5, 6});

//通过给定的数据和字符编码返回一个ByteBuf对象
ByteBuf byteBuf = Unpooled.copiedBuffer("hello,world!", Charset.forName("utf-8"));
```
