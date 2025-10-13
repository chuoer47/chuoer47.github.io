---
title: NIO
date: 2024-10-23 16:24:22
tags: 网络编程
order: 20
icon: "/img/java.svg"
---



# NIO

## 一、I/O模型

### 1、I/O模型的基本说明

**IO 模型简单的理解**:就是用什么样的通道进行数据的发送和接收，很大程度上决定了程序通信的性能。

UNIX 系统下， IO 模型一共有 5 种：**同步阻塞 I/O**、**同步非阻塞 I/O**、**I/O 多路复用**、**信号驱动 I/O** 和**异步 I/O**。

* 同步：线程自己去获取结果（一个线程）
* 异步：线程自己不去获取结果，而是由其它线程送结果（至少两个线程）

Java 共支持三种网络编程I/O模式：BIO, NIO,  AIO

**（1）BIO (Blocking I/O)**

BIO 属于同步阻塞 IO 模型 。同步阻塞 IO 模型中，应用程序发起 read 调用后，会一直阻塞，直到内核把数据拷贝到用户空间。

**（2）NIO (Non-blocking/New I/O)**

> Java 中的 NIO 于 Java 1.4 中引入，对应 `java.nio` 包，提供了 `Channel` , `Selector`，`Buffer` 等抽象。NIO 中的 N 可以理解为 Non-blocking，不单纯是 New。它是支持面向缓冲的，基于通道的 I/O 操作方法。 对于高负载、高并发的（网络）应用，应使用 NIO 。

Java 中的 NIO 可以看作是 **I/O 多路复用模型**。也有很多人认为，Java 中的 NIO 属于同步非阻塞 IO 模型。

我们先来看看 **同步非阻塞 IO 模型**。

![图源：《深入拆解Tomcat & Jetty》](/image\jvm\jvm90.png)

同步非阻塞 IO 模型中，应用程序会一直发起 read 调用，等待数据从内核空间拷贝到用户空间的这段时间里，线程依然是阻塞的，直到在内核把数据拷贝到用户空间。相比于同步阻塞 IO 模型，同步非阻塞 IO 模型确实有了很大改进。通过轮询操作，避免了一直阻塞。

但是，这种 IO 模型同样存在问题：**应用程序不断进行 I/O 系统调用轮询数据是否已经准备好的过程是十分消耗 CPU 资源的。**

这个时候，**I/O 多路复用模型** 就上场了。

![](/image\jvm\jvm91.png)

IO 多路复用模型中，线程首先发起 select 调用，询问内核数据是否准备就绪，等内核把数据准备好了，用户线程再发起 read 调用。read 调用的过程（数据从内核空间 -> 用户空间）还是阻塞的。

> 目前支持 IO 多路复用的系统调用，有 select，epoll 等等。select 系统调用，目前几乎在所有的操作系统上都有支持。
>
> - **select 调用**：内核提供的系统调用，它支持一次查询多个系统调用的可用状态。几乎所有的操作系统都支持。
> - **epoll 调用**：linux 2.6 内核，属于 select 调用的增强版本，优化了 IO 的执行效率。

**IO 多路复用模型，通过减少无效的系统调用，减少了对 CPU 资源的消耗。**

Java 中的 NIO ，有一个非常重要的**选择器 ( Selector )** 的概念，也可以被称为 **多路复用器**。通过它，只需要一个线程便可以管理多个客户端连接。当客户端数据到了之后，才会为其服务。

![Buffer、Channel和Selector三者之间的关系](/image\jvm\jvm92.png)

**（3）AIO (Asynchronous I/O)**

AIO 也就是 NIO 2。Java 7 中引入了 NIO 的改进版 NIO 2,它是异步 IO 模型。异步 IO 是基于事件和回调机制实现的，也就是应用操作之后会直接返回，不会堵塞在那里，当后台处理完成，操作系统会通知相应的线程进行后续的操作。

### 2、BIO、NIO、AIO使用场景

- BIO方式适用于连接数目比较小且固定的架构，这种方式对服务器资源要求比较高，并发局限于应用中，JDK1.4以前唯一的选择，但是程序简单容易理解。
- NIO方式适用于连接数目多且连接比较短（轻操作）的架构，比如聊天服务器，弹幕系统，服务器间通讯等。程序比较复杂，JDK1.4开始支持。
- AIO方式适用于连接数目多且连接比较长（重操作）的架构，比如相册服务器，充分调用OS参与并发操作，变成比较复杂，JDK7开始支持。

### 3、BIO问题分析

- 1、每个请求都需要独立创建线程，与对应的客户端进行数据Read,业务处理，数据Write;
- 2、当数据并发较大时，需要创建大量线程处理连接，系统资源占用较大；
- 3、连接建立后，如果当前线程暂时没有数据可读，则线程就阻塞在Read操作上，造成线程资源浪费。

## 二、Java NIO 三大组件

### 1、Channel & Buffer

channel 有一点类似于 stream，它就是读写数据的**双向通道**，可以从 channel 将数据读入 buffer，也可以将 buffer 的数据写入 channel，而之前的 stream 要么是输入，要么是输出，channel 比 stream 更为底层

常见的 Channel 有

* FileChannel、DatagramChannel、SocketChannel、ServerSocketChannel

buffer 则用来缓冲读写数据，常见的 buffer 有

* ByteBuffer
  * MappedByteBuffer
  * DirectByteBuffer
  * HeapByteBuffer
* ShortBuffer、IntBuffer、LongBuffer、FloatBuffer、DoubleBuffer、CharBuffer

### 2、Selector

selector 的作用就是配合一个线程来管理多个 channel，获取这些 channel 上发生的事件，这些 channel 工作在非阻塞模式下，不会让线程吊死在一个 channel 上。适合连接数特别多，但流量低的场景（low traffic）

<center><img src="/image\jvm\jvm93.png" style="zoom:50%;" /></center>

调用 selector 的 select() 会阻塞直到 channel 发生了读写就绪事件，这些事件发生，select 方法就会返回这些事件交给 thread 来处理

## 三、 ByteBuffer

### 1、使用方法

1. 向 buffer 写入数据，例如调用 channel.read(buffer)
2. 调用 flip() 切换至**读模式**
3. 从 buffer 读取数据，例如调用 buffer.get()
4. 调用 clear() 或 compact() 切换至**写模式**
5. 重复 1~4 步骤

```java
try (RandomAccessFile file = new RandomAccessFile("helloword/data.txt", "rw")) {
            FileChannel channel = file.getChannel();
            ByteBuffer buffer = ByteBuffer.allocate(10);
            do {
                // 向 buffer 写入
                int len = channel.read(buffer);
                log.debug("读到字节数：{}", len);
                if (len == -1) {
                    break;
                }
                // 切换 buffer 读模式
                buffer.flip();
                while(buffer.hasRemaining()) {
                    log.debug("{}", (char)buffer.get());
                }
                // 切换 buffer 写模式
                buffer.clear();
            } while (true);
        } catch (IOException e) {
            e.printStackTrace();
        }
```

### 2、ByteBuffer 结构

ByteBuffer 有以下重要属性

* capacity
* position
* limit

一开始

![](/image\jvm\jvm94.png)

写模式下，position 是写入位置，limit 等于容量，下图表示写入了 4 个字节后的状态

![](/image\jvm\jvm95.png)

flip 动作发生后，position 切换为读取位置，limit 切换为读取限制

![](/image\jvm\jvm96.png)

读取 4 个字节后，状态

![](/image\jvm\jvm97.png)

clear 动作发生后，状态

![](/image\jvm\jvm98.png)

compact 方法，是把未读完的部分向前压缩，然后切换至写模式

![](/image\jvm\jvm99.png)

::: warning

- Buffer 是**无边界的**数据缓冲区，需要自己解决粘包、半包问题 (长度信息、特定分隔符)
- Buffer 是**非线程安全的**

:::

### 3、ByteBuffer 常见方法

#### （1）分配空间

可以使用 allocate 方法为 ByteBuffer 分配空间，其它 buffer 类也有该方法

```java
Bytebuffer buf = ByteBuffer.allocate(16);
```

#### （2）向 buffer 写入数据

有两种办法

* 调用 channel 的 read 方法
* 调用 buffer 自己的 put 方法

```java
int readBytes = channel.read(buf);
```

```java
buf.put((byte)127);
```

#### （3）从 buffer 读取数据

同样有两种办法

* 调用 channel 的 write 方法
* 调用 buffer 自己的 get 方法

```java
int writeBytes = channel.write(buf);
```

```java
byte b = buf.get();
```

get 方法会让 position 读指针向后走，如果想重复读取数据

* 可以调用 rewind 方法将 position 重新置为 0
* 或者调用 get(int i) 方法获取索引 i 的内容，它不会移动读指针

#### （4）mark 和 reset

mark 是在读取时，做一个标记，即使 position 改变，只要调用 reset 就能回到 mark 的位置

```java
ByteBuffer buffer = ByteBuffer.allocate(10);
buffer.put(new byte[]{'a', 'b', 'c', 'd'});
buffer.flip();

System.out.println((char) buffer.get());    // a
System.out.println((char) buffer.get());    // b

// 加标记，索引2 的位置
buffer.mark(); 
System.out.println((char) buffer.get());    // c
System.out.println((char) buffer.get());    // d

// 将 position 重置到索引 2
buffer.reset(); 
System.out.println((char) buffer.get());    // c
System.out.println((char) buffer.get());    // d
```

::: warning

rewind() 和 flip() 都会清除 mark 位置

:::

#### （5）字符串与 ByteBuffer 互转

```java
// 1.1. 字符串 -> ByteBuffer
ByteBuffer buffer1 = ByteBuffer.allocate(16);
buffer1.put("hello".getBytes());

// 1.2. Charset
ByteBuffer buffer2 = StandardCharsets.UTF_8.encode("hello");
ByteBuffer buffer3 = Charset.forName("utf-8").encode("你好");

// 1.3. wrap
ByteBuffer buffer4 = ByteBuffer.wrap("hello".getBytes());


// 2. ByteBuffer -> 转为字符串
buffer1.flip();
String str1 = StandardCharsets.UTF_8.decode(buffer1).toString();
String str2 = StandardCharsets.UTF_8.decode(buffer2).toString();
```

### 4、Scattering  And Gathering

- Scattering: 将数据写入到buffer的时候，可以采用buffer数组，几次写入
- Gathering: 从buffer读取数据的时候，可以采用buffer数组，依次读

```java
public class ScatteringAndGatheringTest {
    public static void main(String[] args) throws Exception{
        /**
         * serverSocketChannel 和 socketChannel
         */
        ServerSocketChannel serverSocketChannel = ServerSocketChannel.open();
        InetSocketAddress inetSocketAddress = new InetSocketAddress(6666);
        //绑定端口到socket，并启动
        serverSocketChannel.socket().bind(inetSocketAddress);
        //创建buffer数组
        ByteBuffer[] byteBuffers = new ByteBuffer[2];
        byteBuffers[0] = ByteBuffer.allocate(5);
        byteBuffers[1] = ByteBuffer.allocate(3);
        //等待客户端连接
        SocketChannel socketChannel = serverSocketChannel.accept();
        int messageLength = 8; //假设从客户端接收8个字节
        while(true){
            int byteRead = 0;
            while(byteRead < messageLength){
                long l = socketChannel.read(byteBuffers);
                byteRead += l;
                System.out.println("byteRead="+byteRead);
                //使用流打印，看看当前buffer的position和limit
                Arrays.asList(byteBuffers).stream()
                        .map(byteBuffer -> "position="+ byteBuffer.position()+",limit="+byteBuffer.limit())
                        .forEach(System.out::println);
            }
            //将所有buffer进行flip
            Arrays.asList(byteBuffers).forEach(byteBuffer -> byteBuffer.flip());
            //将数据读出显示到客户端
            long byteWrite = 0;
            while(byteWrite < messageLength){
                long w = socketChannel.write(byteBuffers);
                byteWrite += w;
            }
            //将所有buffer进行clear
            Arrays.asList(byteBuffers).forEach(buffer -> buffer.clear());
            System.out.println("byteRead="+byteRead + ",bytewrite="+byteWrite+",messageLength="+messageLength);

        }
    }
}
```

## 四、文件编程

### 1、 FileChannel

⚠️ FileChannel 工作模式，**FileChannel 只能工作在阻塞模式**

**1）获取**

不能直接打开 FileChannel，必须通过 FileInputStream、FileOutputStream 或者 RandomAccessFile 来获取 FileChannel，它们都有 getChannel 方法

::: tip 注意

* 通过 FileInputStream 获取的 channel 只能读
* 通过 FileOutputStream 获取的 channel 只能写
* 通过 RandomAccessFile 是否能读写根据构造 RandomAccessFile 时的读写模式决定

:::

**2）读取**

会从 channel 读取数据填充 ByteBuffer，返回值表示读到了多少字节，-1 表示到达了文件的末尾

```java
int readBytes = channel.read(buffer);
```

**3）写入**

写入的正确姿势如下， SocketChannel

```java
ByteBuffer buffer = ...;
buffer.put(...); // 存入数据
buffer.flip();   // 切换读模式

while(buffer.hasRemaining()) {
    channel.write(buffer);
}
```

在 while 中调用 channel.write 是因为 write 方法并不能保证一次将 buffer 中的内容全部写入 channel

**4）关闭**

channel 必须关闭，不过调用了 FileInputStream、FileOutputStream 或者 RandomAccessFile 的 close 方法会间接地调用 channel 的 close 方法

**5）位置**

获取当前位置

```java
long pos = channel.position();
```

设置当前位置

```java
long newPos = ...;
channel.position(newPos);
```

设置当前位置时，如果设置为文件的末尾

* 这时读取会返回 -1 
* 这时写入，会追加内容，但要注意如果 position 超过了文件末尾，再写入时在新内容和原末尾之间会有空洞（00）

**6）大小**

使用 size 方法获取文件的大小

**7）强制写入**

操作系统出于性能的考虑，会将数据缓存，不是立刻写入磁盘。可以调用 force(true)  方法将文件内容和元数据（文件的权限等信息）立刻写入磁盘

### 2、 两个 Channel 传输数据

```java
String FROM = "helloword/data.txt";
String TO = "helloword/to.txt";
long start = System.nanoTime();
try (FileChannel from = new FileInputStream(FROM).getChannel();
     FileChannel to = new FileOutputStream(TO).getChannel();
    ) {
    from.transferTo(0, from.size(), to);
} catch (IOException e) {
    e.printStackTrace();
}
long end = System.nanoTime();
System.out.println("transferTo 用时：" + (end - start) / 1000_000.0);
```

超过 2g 大小的文件传输

```java
public class TestFileChannelTransferTo {
    public static void main(String[] args) {
        try (
                FileChannel from = new FileInputStream("data.txt").getChannel();
                FileChannel to = new FileOutputStream("to.txt").getChannel();
        ) {
            // 效率高，底层会利用操作系统的零拷贝进行优化
            long size = from.size();
            // left 变量代表还剩余多少字节
            for (long left = size; left > 0; ) {
                System.out.println("position:" + (size - left) + " left:" + left);
                left -= from.transferTo((size - left), left, to);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 3、 Path

jdk7 引入了 Path 和 Paths 类

* Path 用来表示文件路径
* Paths 是工具类，用来获取 Path 实例

```java
// 相对路径，使用 user.dir 环境变量来定位 1.txt
Path source = Paths.get("1.txt");

// 绝对路径
Path source = Paths.get("d:\\1.txt");
Path source = Paths.get("d:/1.txt");

// 自动拼接，表示 d:\data\projects
Path projects = Paths.get("d:\\data", "projects");

// normalize 标准化路径
Path path = Paths.get("d:\\data\\projects\\a\\..\\b");
System.out.println(path.normalize()); // 输出 d:\data\projects\b
```

### 4、 Files

```java
// 判断文件是否存在
System.out.println(Files.exists(path));


// 创建单级目录，已存在则抛出异常
Files.createDirectory(path);
// 创建多级目录，已存在也不抛异常
Files.createDirectories(path);


// 拷贝文件
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
// 移动文件
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
// 删除文件/空目录
Files.delete(target);
```



遍历目录文件

```java
// walk 返回一个文件流
Files.walk(path, maxDepth, options).forEach(path -> {...});

// walkFileTree 配合 FileVisitor 提供更加灵活的处理访问
Files.walkFileTree(Paths.get("C:\\Users\\chanper\\Downloads"), new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        System.out.println(file.getFileName());
        return super.visitFile(file, attrs);
    }
    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
        System.out.println(dir.getFileName());
        return super.postVisitDirectory(dir, exc);
    }
});
```



删除多级目录

```java
Path path = Paths.get("d:\\a");
Files.walkFileTree(path, new SimpleFileVisitor<Path>(){
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) 
        throws IOException {
        Files.delete(file);
        return super.visitFile(file, attrs);
    }

    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc) 
        throws IOException {
        Files.delete(dir);
        return super.postVisitDirectory(dir, exc);
    }
});
```



拷贝多级目录

```java
long start = System.currentTimeMillis();
String source = "D:\\Snipaste-1.16.2-x64";
String target = "D:\\Snipaste-1.16.2-x64aaa";

Files.walk(Paths.get(source)).forEach(path -> {
    try {
        String targetName = path.toString().replace(source, target);
        // 是目录
        if (Files.isDirectory(path)) {
            Files.createDirectory(Paths.get(targetName));
        }
        // 是普通文件
        else if (Files.isRegularFile(path)) {
            Files.copy(path, Paths.get(targetName));
        }
    } catch (IOException e) {
        e.printStackTrace();
    }
});
long end = System.currentTimeMillis();
System.out.println(end - start);
```

## 五、网络编程

### 1、 非阻塞 vs 阻塞

#### 1）阻塞

* 阻塞模式下，相关方法都会导致线程暂停
  * ServerSocketChannel.accept 会在没有连接建立时让线程暂停
  * SocketChannel.read 会在没有数据可读时让线程暂停
  * 阻塞的表现其实就是线程暂停了，暂停期间不会占用 cpu，但线程相当于闲置

服务器端

```java
// 使用 nio 来理解阻塞模式, 单线程
// 0. ByteBuffer
ByteBuffer buffer = ByteBuffer.allocate(16);
// 1. 创建了服务器
ServerSocketChannel ssc = ServerSocketChannel.open();

// 2. 绑定监听端口
ssc.bind(new InetSocketAddress(8080));

// 3. 连接集合
List<SocketChannel> channels = new ArrayList<>();
while (true) {
    // 4. accept 建立与客户端连接， SocketChannel 用来与客户端之间通信
    log.debug("connecting...");
    SocketChannel sc = ssc.accept(); // 阻塞方法，线程停止运行
    log.debug("connected... {}", sc);
    channels.add(sc);
    for (SocketChannel channel : channels) {
        // 5. 接收客户端发送的数据
        log.debug("before read... {}", channel);
        channel.read(buffer); // 阻塞方法，线程停止运行
        buffer.flip();
        debugRead(buffer);
        buffer.clear();
        log.debug("after read...{}", channel);
    }
}
```

客户端

```java
SocketChannel sc = SocketChannel.open();
sc.connect(new InetSocketAddress("localhost", 8080));
System.out.println("waiting...");
```

::: tip 存在的问题

* 单线程下，阻塞方法之间相互影响，几乎不能正常工作，需要多线程支持
* 但多线程下，有新的问题，体现在以下方面
  * 32 位 jvm 一个线程 320k，64 位 jvm 一个线程 1024k，如果连接数过多，必然导致 OOM，并且线程太多，反而会因为频繁上下文切换导致性能降低
  * 可以采用线程池技术来减少线程数和线程上下文切换，但治标不治本，如果有很多连接建立，但长时间 inactive，会阻塞线程池中所有线程，因此不适合长连接，只适合短连接

:::

#### 2）非阻塞

* 非阻塞模式下，相关方法都会不会让线程暂停
  * 在 ServerSocketChannel.accept 在没有连接建立时，会返回 null，继续运行
  * SocketChannel.read 在没有数据可读时，会返回 0，但线程不必阻塞，可以去执行其它 SocketChannel 的 read 或是去执行 ServerSocketChannel.accept 
  * 写数据时，线程只是等待数据写入 Channel 即可，无需等 Channel 通过网络把数据发送出去

服务器端，客户端代码不变

```java
// 使用 nio 来理解非阻塞模式, 单线程
// 0. ByteBuffer
ByteBuffer buffer = ByteBuffer.allocate(16);
// 1. 创建了服务器
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false); // 非阻塞模式
// 2. 绑定监听端口
ssc.bind(new InetSocketAddress(8080));
// 3. 连接集合
List<SocketChannel> channels = new ArrayList<>();
while (true) {
    // 4. accept 建立与客户端连接， SocketChannel 用来与客户端之间通信
    SocketChannel sc = ssc.accept(); // 非阻塞，线程还会继续运行，如果没有连接建立，但sc是null
    if (sc != null) {
        log.debug("connected... {}", sc);
        sc.configureBlocking(false); // 非阻塞模式
        channels.add(sc);
    }
    for (SocketChannel channel : channels) {
        // 5. 接收客户端发送的数据
        int read = channel.read(buffer);// 非阻塞，线程仍然会继续运行，如果没有读到数据，read 返回 0
        if (read > 0) {
            buffer.flip();
            debugRead(buffer);
            buffer.clear();
            log.debug("after read...{}", channel);
        }
    }
}
```

::: tip 存在的问题

* 但非阻塞模式下，即使没有连接建立，和可读数据，线程仍然在不断运行，白白浪费了 cpu
* 数据复制过程中，线程实际还是阻塞的（AIO 改进的地方）

:::

### 2、Selector

单线程可以配合 Selector 完成对多个 Channel 可读写事件的监控，这称之为多路复用

* 多路复用仅针对网络 IO、普通文件 IO 没法利用多路复用
* 如果不用 Selector 的非阻塞模式，线程大部分时间都在做无用功，而 Selector 能够保证
  * 有可连接事件时才去连接
  * 有可读事件才去读取
  * 有可写事件才去写入
    * 限于网络传输能力，Channel 未必时时可写，一旦 Channel 可写，会触发 Selector 的可写事件

<center><img src="/image\jvm\jvm93.png" style="zoom:50%;" /></center>

::: info 好处

* 一个线程配合 selector 就可以监控多个 channel 的事件，事件发生线程才去处理。避免非阻塞模式下所做无用功
* 让这个线程能够被充分利用
* 节约了线程的数量
* 减少了线程上下文切换

:::

::: tip 底层实现

Java NIO 会根据操作系统、JDK 版本、运行环境选择合适的底层实现，通常倾向于使用更高性能的 epoll 模型，以提供更好的性能和并发处理能力。

:::

**创建**

```java
Selector selector = Selector.open();
```

**注册事件**

```java
channel.configureBlocking(false);
SelectionKey key = channel.register(selector, 绑定事件);
```

* channel 必须工作在非阻塞模式
* FileChannel 没有非阻塞模式，因此不能配合 selector 一起使用
* 绑定的事件类型可以有
  * connect - 客户端连接成功时触发
  * accept - 服务器端成功接受连接时触发
  * read - 数据可读入时触发，有因为接收能力弱，数据暂不能读入的情况
  * write - 数据可写出时触发，有因为发送能力弱，数据暂不能写出的情况

**监听 Channel 事件**

可以通过下面三种方法来监听是否有事件发生，方法的返回值代表有多少 channel 发生了事件

```java
//方法1，阻塞直到绑定事件发生
int count = selector.select();

//方法2，阻塞直到绑定事件发生，或是超时（时间单位为 ms）
int count = selector.select(long timeout);

//方法3，不会阻塞，也就是不管有没有事件，立刻返回，自己根据返回值检查是否有事件
int count = selector.selectNow();
```



 ::: tip select 何时不阻塞

* 事件发生时
  * 客户端发起连接请求，会触发 accept 事件
  * 客户端发送数据过来，客户端正常、异常关闭时，都会触发 read 事件，另外如果发送的数据大于 buffer 缓冲区，会触发多次读取事件
  * channel 可写，会触发 write 事件
  * 在 linux 下 nio bug 发生时
* 调用 selector.wakeup()
* 调用 selector.close()
* selector 所在线程 interrupt

:::

### 3、处理事件

服务端模版

```java
// 1.创建 Selector, ServerSocketChannel
Selector selector = Selector.open();
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);

// 2.关联 selector、ssc，并注册感兴趣事件
SelectionKey sscKey = ssc.register(selector, SelectionKey.OP_ACCEPT, null);
ssc.bind(new InetSocketAddress(8080));

while (true) {
    // 3.select阻塞方法，返回发生了且未处理的事件
    selector.select();
    
    // 4.处理事件
    Iterator<SelectionKey> iter = selector.selectedKeys().iterator();
    while (iter.hasNext()) {
        SelectionKey key = iter.next();
        
        // 5.根据事件类型做处理
        if (key.isAcceptable()) {
            ...            
        } else if(key.isReadable()) {
            ...
        } else if(key.isWritable()) {
            ...
        }

        iter.remove();
    }
}
```

- SelectionKey 封装了发生的事件类型，以及对应的 channel 用于和客户端进行通信

  ```java
  selectionKey.isAcceptable();
  selectionKey.isConnectable();
  selectionKey.isReadable();
  selectionKey.isWritable();
  
  SocketChannel channel = (SocketChannel) selectionKey.channel();
  ```

- 由于 NIO 底层使用水平触发，因此监测到事件后必须处理/取消，否则后续仍然会触发

  ```java
  // 取消注册在 selector 上的 channel，并将 key 加入 cancelledKeys 集合等待删除
  selectionKey.cancel()
  ```

- Selector 会向 selectedKeys 集合里新增待处理的元素，但不会主动移除，因此要手动移除处理完毕的 SelectionKey

#### 1）处理 accept

```java
if (key.isAcceptable()) {
    // 此 ssc 即服务端一开始 open 的 ServerSocketChannel（门卫）
    ServerSocketChannel ssc = (ServerSocketChannel) key.channel();
    // 此 sc 为专用于和某个客户端通信的 SocketChannel
    SocketChannel sc = ssc.accept();

    // 将此 SocketChannel 注册到 selector，并注册后续关注的事件
    sc.register(selector, SelectionKey.OP_READ | SelectionKey.OP_WRITE, null);
}
```

#### 2）处理 read

麻烦的地方在于处理数据的边界，即粘包半包问题，常用的方案有：

- 固定长度消息，缺点是浪费带宽
- 指定分隔符，缺点是效率低
- TLV（Type-Length-Value），缺点是 buffer 需要提前分配，如果内容过大，会影响 server 吞吐量

```java
...

ByteBuffer byteBuffer = ByteBuffer.allocate(128);
// 添加 attachment
SelectionKey scKey = sc.register(selector, SelectionKey.OP_READ, byteBuffer);

...                 
if (key.isAcceptable()) {
    SocketChannel sc = ssc.accept();
    sc.configureBlocking(false);
    
    ByteBuffer byteBuffer = ByteBuffer.allocate(7);
    // 把要写入的 ByteBuffer 作为附件加入 selectionKey
    SelectionKey scKey = sc.register(selector, SelectionKey.OP_READ, byteBuffer);      
} else if (key.isReadable()) {
    try {
        // 此 SocketChannel 即 ssc 接受连接后注册到 selector 的 sc
        SocketChannel channel = (SocketChannel) key.channel();
        // 获取 selectionKey 上关联的附件
        ByteBuffer buffer = (ByteBuffer) key.attachment();
        int read = channel.read(buffer);
        if(read == -1) {
            key.cancel();
        } else {
            split(buffer);
            // 需要扩容
            if (buffer.position() == buffer.limit()) {
                ByteBuffer newBuffer = ByteBuffer.allocate(buffer.capacity() * 2);
                buffer.flip();
                newBuffer.put(buffer); // 0123456789abcdef3333\n
                key.attach(newBuffer);
            }
        }
    } catch (IOException e) {
        e.printStackTrace();
        key.cancel();  // 因为客户端断开了,因此需要将 key 取消（从 selector 的 keys 集合中真正删除 key）
    }
}

...

private static void split(ByteBuffer source) {
    source.flip();
    for (int i = 0; i < source.limit(); i++) {
        // 找到一条完整消息
        if (source.get(i) == '\n') {
            int length = i + 1 - source.position();
            ByteBuffer target = ByteBuffer.allocate(length);
            for (int j = 0; j < length; j++)
                target.put(source.get());
            debugAll(target);//打印所有内容
        }
    }
    source.compact();
}
```

::: tip ByteBuffer 大小分配

- 每个 channel 都需要记录可能被切分的消息，因为 ByteBuffer 不能被多个 channel 共同使用，因此需要为每个 channel 维护一个独立的 ByteBuffer
- ByteBuffer 不能太大，比如一个 ByteBuffer 1Mb 的话，要支持百万连接就要 1Tb 内存，因此需要设计大小可变的 ByteBuffer
  - 一种思路是首先分配一个较小的 buffer，例如 4k，如果发现数据不够，再分配 8k 的 buffer，将 4k buffer 内容拷贝至 8k buffer，优点是消息连续容易处理，缺点是数据拷贝耗费性能，参考实现 [http://tutorials.jenkov.com/java-performance/resizable-array.html](http://tutorials.jenkov.com/java-performance/resizable-array.html)
  - 另一种思路是用多个数组组成 buffer，一个数组不够，把多出来的内容写入新的数组，与前面的区别是消息存储不连续解析复杂，优点是避免了拷贝引起的性能损耗

实际上，Netty 的 ByteBuf 就是支持动态伸缩扩容的。

:::

#### 3）处理 write

非阻塞模式下，由于缓冲区阻塞、网络拥塞等原因，无法保证一次性把 buffer 中所有数据都写入 channel，因此需要追踪 write 方法的返回值做不同的处理。另外，用 selector 监听所有 channel 的可写事件，每个 channel 都需要一个 key 来跟踪 buffer，这样会导致占用内存过多，于是就有两阶段策略：

- 当消息处理器第一次写入消息时，才将 channel 注册到 selector 上
- selector 检查 channel 上的可写事件，如果所有的数据写完了，就取消 channel 的注册

只要向 channel 发送数据时，socket 缓冲可写，这个事件会频繁触发，因此应当只在 socket 缓冲区写不下时再关注可写事件，数据写完之后取消关注或取消注册。

**服务端**

```java
if (key.isAcceptable()) {
    SocketChannel sc = ssc.accept();
    sc.configureBlocking(false);
    SelectionKey sckey = sc.register(selector, SelectionKey.OP_READ);
    
    // 连接后向客户端发送内容
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 3000000; i++)
        sb.append("a");
    ByteBuffer buffer = Charset.defaultCharset().encode(sb.toString());
    
    int write = sc.write(buffer);
    if (buffer.hasRemaining()) {
        // 关注可写事件
        sckey.interestOps(sckey.interestOps() + SelectionKey.OP_WRITE);
        // 把要发送的 ByteBuffer 作为附件加入 SelectionKey
        sckey.attach(buffer);
    }
} else if (key.isWritable()) {
    // 拿到要发送的 ByteBuffer
    ByteBuffer buffer = (ByteBuffer) key.attachment();
    SocketChannel sc = (SocketChannel) key.channel();
    
    int write = sc.write(buffer);
    if (!buffer.hasRemaining()) {   // 如果写完了
        key.interestOps(key.interestOps() ^ SelectionKey.OP_WRITE);
        key.attach(null);
    }
}
```

**客户端**

```java
if (key.isConnectable()) {
    System.out.println(sc.finishConnect());
} else if (key.isReadable()) {
    ByteBuffer buffer = ByteBuffer.allocate(1024 * 1024);
    count += sc.read(buffer);
    buffer.clear();
    System.out.println(count);
}
```



### 4、多线程优化

::: tip 利用多线程优化

现在的 CPU 基本都是多核设计，编码时要充分利用多核 CPU 的能力，因此可以引入多线程，提高程序的 IO 能力。具体的，可以分成两组 selector：

- 单个 Boss 线程轮询 selector，专门处理 accept 事件
- 多个 Worker 线程，负责处理其它事件

:::

```java
public class MultiThreadServer {
    
    public static void main(String[] args) throws IOException {
        Thread.currentThread().setName("boss");
        ServerSocketChannel ssc = ServerSocketChannel.open();
        ssc.configureBlocking(false);
        
        Selector boss = Selector.open();
        ssc.register(boss, SelectionKey.OP_ACCEPT);
        ssc.bind(new InetSocketAddress(8080));
        
        // 创建固定数量 worker
        Worker[] workers = new Worker[Runtime.getRuntime().availableProcessors()];
        for (int i = 0; i < workers.length; i++) {
            workers[i] = new Worker("worker-" + i);
        }
        
        Integer index = 0;
        while (true) {
            boss.select();
            Iterator<SelectionKey> iter = boss.selectedKeys().iterator();
            while (iter.hasNext()) {
                SelectionKey key = iter.next();
                iter.remove();
                
                if (key.isAcceptable()) {
                    SocketChannel sc = ssc.accept();
                    sc.configureBlocking(false);
                    log.debug("connected with {}", sc.getRemoteAddress());
                    
                    // 基于轮询LB策略，关联worker
                    workers[index++ % workers.length].register(sc);
                }
            }
        }
    }
    
    static class Worker implements Runnable {
        private Selector selector;
        private String name;
        private volatile boolean start = false; // 还未初始化
        
        private ConcurrentLinkedQueue<Runnable> tasks = new ConcurrentLinkedQueue<>();
        
        public Worker(String name) {
            this.name = name;
        }
        
        // boss线程运行
        public void register(SocketChannel sc) throws IOException {
            if (!start) {
                selector = Selector.open();
                new Thread(this, name).start();
                start = true;
            }
            // 通过消息队列在线程间传递数据，避免多线程阻塞问题
            tasks.offer(() -> {
                try {
                    sc.register(selector, SelectionKey.OP_READ);
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            });
            selector.wakeup();
        }
        
        // worker线程运行
        @Override
        public void run() {
            while (true) {
                try {
                    selector.select();
                    Runnable task = tasks.poll();
                    if (task != null) {
                        task.run();
                    }
                    
                    Iterator<SelectionKey> iter = selector.selectedKeys().iterator();
                    while (iter.hasNext()) {
                        SelectionKey key = iter.next();
                        iter.remove();
                        
                        if (key.isReadable()) {
                            ByteBuffer buffer = ByteBuffer.allocate(16);
                            SocketChannel channel = (SocketChannel) key.channel();
                            channel.read(buffer);
                            buffer.flip();
                            debugAll(buffer);
                        }
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
        }
    }
}
```

::: info 如何拿到 CPU 个数

一般 worker 线程的数量可以设为 CPU 核心数，以充分利用 CPU 资源。Java 中 Runtime.getRuntime().availableProcessors() 可以获取机器的 CPU 核心数。

但如果工作在 Docker 容器下，由于容器不是物理隔离的，会拿到实际的物理 CPU 数，而不是容器分配的 CPU 个数。这个问题直到 jdk 10 才修复，可以用 JVM 参数 UseContainerSupport 配置， 默认开启。

:::

## 六、零拷贝

#### 传统 IO 问题

传统的 IO 将一个文件通过 socket 写出

```java
File f = new File("helloword/data.txt");
RandomAccessFile file = new RandomAccessFile(file, "r");

byte[] buf = new byte[(int)f.length()];
file.read(buf);

Socket socket = ...;
socket.getOutputStream().write(buf);
```

内部工作流程是这样的：

![](/image\jvm\jvm103.png)

1. java 本身并不具备 IO 读写能力，因此 read 方法调用后，要从 java 程序的**用户态**切换至**内核态**，去调用操作系统（Kernel）的读能力，将数据读入**内核缓冲区**。这期间用户线程阻塞，操作系统使用 DMA（Direct Memory Access）来实现文件读，其间也不会使用 cpu

   > DMA 也可以理解为硬件单元，用来解放 cpu 完成文件 IO

2. 从**内核态**切换回**用户态**，将数据从**内核缓冲区**读入**用户缓冲区**（即 byte[] buf），这期间 cpu 会参与拷贝，无法利用 DMA

3. 调用 write 方法，这时将数据从**用户缓冲区**（byte[] buf）写入 **socket 缓冲区**，cpu 会参与拷贝

4. 接下来要向网卡写数据，这项能力 java 又不具备，因此又得从**用户态**切换至**内核态**，调用操作系统的写能力，使用 DMA 将 **socket 缓冲区**的数据写入网卡，不会使用 cpu



可以看到中间环节较多，java 的 IO 实际不是物理设备级别的读写，而是缓存的复制，底层的真正读写是操作系统来完成的

* 用户态与内核态的切换发生了 3 次，这个操作比较重量级
* 数据拷贝了共 4 次



#### NIO 优化

通过 DirectByteBuf 

* ByteBuffer.allocate(10)  HeapByteBuffer 使用的还是 java 内存
* ByteBuffer.allocateDirect(10)  DirectByteBuffer 使用的是操作系统内存

![](/image\jvm\jvm100.png)

大部分步骤与优化前相同，不再赘述。唯有一点：java 可以使用 DirectByteBuf 将堆外内存映射到 jvm 内存中来直接访问使用

* 这块内存不受 jvm 垃圾回收的影响，因此内存地址固定，有助于 IO 读写
* java 中的 DirectByteBuf 对象仅维护了此内存的虚引用，内存回收分成两步
  * DirectByteBuf 对象被垃圾回收，将虚引用加入引用队列
  * 通过专门线程访问引用队列，根据虚引用释放堆外内存
* 减少了一次数据拷贝，用户态与内核态的切换次数没有减少



进一步优化（底层采用了 linux 2.1 后提供的 sendFile 方法），java 中对应着两个 channel 调用 transferTo/transferFrom 方法拷贝数据

![](/image\jvm\jvm101.png)

1. java 调用 transferTo 方法后，要从 java 程序的**用户态**切换至**内核态**，使用 DMA将数据读入**内核缓冲区**，不会使用 cpu
2. 数据从**内核缓冲区**传输到 **socket 缓冲区**，cpu 会参与拷贝
3. 最后使用 DMA 将 **socket 缓冲区**的数据写入网卡，不会使用 cpu

可以看到

* 只发生了一次用户态与内核态的切换
* 数据拷贝了 3 次



进一步优化（linux 2.4）

![](/image\jvm\jvm102.png)

1. java 调用 transferTo 方法后，要从 java 程序的**用户态**切换至**内核态**，使用 DMA将数据读入**内核缓冲区**，不会使用 cpu
2. 只会将一些 offset 和 length 信息拷入 **socket 缓冲区**，几乎无消耗
3. 使用 DMA 将 **内核缓冲区**的数据写入网卡，不会使用 cpu

整个过程仅只发生了一次用户态与内核态的切换，数据拷贝了 2 次。所谓的【零拷贝】，并不是真正无拷贝，而是在不会拷贝重复数据到 jvm 内存中，零拷贝的优点有

* 更少的用户态与内核态的切换
* 不利用 cpu 计算，减少 cpu 缓存伪共享
* 零拷贝适合小文件传输



