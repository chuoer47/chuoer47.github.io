---
title: Redis单机
date: 2024-11-27 16:14:58
tags: redis
category: 数据库
order: 22
icon: "/img/redis.svg"
---

<!--more-->

# Redis单机

## 一、数据库

### 1、实现

Redis服务器将所有数据库都保存在服务器状态redis.h/redisServer结构的db数组中，db数组的每个项都是一个redis.h/redisDb结构，每个redisDb结构代表一个数据库。数组长度（数据库数量）由dbnum控制，默认有16个，通过`SELECT`命令切换数据库。

RedisClient结构中的db属性指向当前所使用的数据库，SELECT命令原理即修改该指针。

<center><img src="/image/redis/redis21.png"  style="zoom:50%;" /></center>

### 2、键空间

Redis是一个键值对K-V数据库服务器，服务器中的每个数据库都由一个redis.h/redisDb结构表示，其中，redisDb结构的dict字典保存了数据库中的所有键值对，这个字典称为键空间（key space）。所有针对数据库中数据的操作本质上都是对键空间字典的操作，同时也会进行一些维护：

- 读写键时，会记录键空间命中/不命中次数
- 更新键的LRU时间
- 删除读取到的过期键
- watch命令监视某个键时，修改后标记dirty，告知事务程序
- 根据配置发送相应的通知

### 3、过期回收

- `Expire | pExpire | ExpireAt | pExpireAt <key> <time>`指定键的过期时间，单位s，p开头的命令单位ms
    - 实现上前三个最终都调用pExpireAt实现
    - 底层在redisDb结构的expires字典保存所有键的过期时间，称过期字典。其键指向某个键的对象，其值是long long类型整数，表示ms精度的Unix时间戳
- `TTL | pTTL <key>`返回剩余生存时间，即查询键的过期时间和当前时间之差
- `Persist <key>`移除某个键的过期时间，即删除过期字典的某个键值对

<center><img src="/image/redis/redis22.png"  style="zoom:50%;" /></center>

- 不同的回收策略：
    - 定时删除：创建定时器自动删除。内存友好，但消耗CPU时间
    - 惰性删除：访问键时才执行判断删除。CPU友好，但容易造成部分键长时间无法删除
    - 定期删除：每隔一段时间执行一次过期删除。上面两种方法的综合，但难以确定执行的频率和时长
- Redis的回收策略：惰性删除 + 定期删除
    - 惰性删除由db.c/expireIfNeeded函数实现。算法同上
    - 定期删除由redis.c/activeExpireCycle函数实现。在规定时间内，分多次遍历服务器中的各个数据库，从expires字典中随机检查一部分键的过期时间，并删除过期键。

### 4、AOF、RDB和复制功能对过期键的处理

- RDB持久化：
    - 保存时，过期键不会写入新创建的RDB文件；
    - 载入时，如果是主服务器模式，过期键不会加载
    - 载入时，如果是从服务器模式，过期键依然会加载，由主从同步保证数据一致性

- AOF持久化:
    - 保存时没有任何影响。但过期删除后，会向AOF文件追加DEL命令，显式记录该键已删除
    - 重写时过期键不会写入
- 复制功能：由主服务器控制从服务器同意删除过期键，保证主从服务器的数据一致性
    - 主服务器在删除一个过期键之后，会显式地向所有从服务器发送一个DEL命令，告知从服务器删除这个过期键
    - 从服务器执行读命令时，即使碰到过期键也不会删除，继续像处理未过期键一样来处理
    - 从服务器只有在接到主服务器发来的DEL命令之后，才会删除过期键

### 5、数据库通知

- 键空间通知：关于"某个键执行了什么命令"的通知 `SUBSCRIBE __keyspace@0__:<key>`
- 键事件通知：关于"某个命令被什么键执行"的通知 `SUBSCRIBE __keyevent@0__:<opt>`
- 服务器配置的notify-keyspace-events选项决定了服务器所发送通知的类型
- 底层由`notify.c/notifyKeyspaceEvent(type, event, key, bdid)`函数实现

## 二、RDB持久化

Redis提供RDB持久化功能，将内存数据保存到磁盘，生成经过压缩的二进制文件，避免数据丢失。

### 1、RDB文件的创建与载入

- 创建：
    - SAVE：阻塞服务器进程，由主线程执行保存。
        - 执行期间，所有客户端命令都会被拒绝
    - BGSAVE：创建子进程执行保存
        - 执行期间，新的SAVE、BGSAVE命令会被拒绝，防止竞争
        - 执行期间，新的BGREWRITEAOF命令延迟到保存任务结束执行
        - 出于性能考虑，BGREWRITEAOF命令执行期间，新的BGSAVE命令会被拒绝

- 载入：
    - 服务器启动时自动载入，但优先级低于AOF文件
    - 载入期间，服务器一直处于阻塞状态

### 2、自动保存

serverCron服务器周期性函数每隔100ms执行一次维护，其中包括RDB保存。触发的条件由配置中的save选项定义，程序会遍历并检查saveparams数组中的所有保存条件,只要任何一个满足，将自动执行BGSAVE命令。

```properties
# save <time> <changes>
# 服务器在900秒之内，对数据库进行了至少1次修改。
save 900 1 
# 服务器在300秒之内，对数据库进行了至少10次修改。
save 300 10
#服务器在60秒之内，对数据库进行了至少10000次修改。
save 60 10000
```

在实现上：redisServer结构的

- saveparams数组保存触发条件
- dirty计数器记录上次成功执行SAVE/BGSAVE后，所有数据库修改的总次数（每个键算一次）
- lastsave属性记录上次成功执行SAVE/BGSAVE的时间

### 3、RDB文件结构

**整体结构:**

<center><img src="/image/redis/redis23.jpg"  style="zoom:50%;" /></center>

- REDIS：RDB文件常量标志，占5Byte
- db_version: RDB文件版本号，占4Byte
- databases: 包含所有数据库数据，长度由数据库数据决定
- EOF：末尾常量标记，占1ByteREDIS_ENCODING_
- check_sum: 前4个字段的校验和，占8byte长的无符号整数

**database部分:**

<center><img src="/image/redis/redis24.png"  style="zoom:50%;" /></center>

- SELECTDB: 标记下一个将读入数据库编号，占1Byte
- db_number: 数据库编号，占1/2/5Byte。读入后调用SELECT切换数据库
- key_value_pairs: 所有数据库的键值对数据，以及可选的过期时间

**key_value_pairs部分:**

<center><img src="/image/redis/redis25.png"  style="zoom:50%;" /></center>

- EXPIRETIME_MS: 可选，标记下一个将读入以ms为单位的过期时间，占1Byte
- ms: 可选，UNIX时间戳，8Byte有符号整数
- TYPE: 值对象类型/底层编码
- key: 字符串对象表示的键
- value: 值对象

**value部分:**

<center><img src="/image/redis/redis26.png"  style="zoom:50%;" /></center>

- 字符串对象：
    - 如果是`REDIS_ENCODING_INT`，则以 `ENCODING+integer` 的形式保存，ENCODING标记占8/16/32位长
    - 如果是`REDIS_ENCODING_RAW`，则保存的是字符串
        - 对于长度$<=20Byte$的串，以 `len+string` 的形式保存
        - 对于长度$>20Byte$的串，以 `REDIS_RDB_ENC_LZF+compressed_len+origin_len+compressed_string `的形式保存，其中REDIS_RDB_ENC_LZF是LZF压缩算法标记
- 列表对象：
    - TYPE为`REDIS_RDB_TYPE_LIST`，以` list_length+itemN+... `的形式保存
    - 每个item按字符串对象保存
- 集合对象：
    - TYPE为`REDIS_RDB_TYPE_SET`，以 `set_size+elemN+... `的形式保存
    - 每个elem按字符串对象保存
- 哈希表对象：
    - TYPE为`REDIS_RDB_TYPE_HASH`，以 `hash_size+keyN+valueN+... `的形式保存
    - 每个键、值按字符串对象相邻保存
- 有序集合对象：
    - TYPE为`REDIS_RDB_TYPE_ZSET`，以 `sorted_set_size+memberN+scoreN+... `的形式保存
    - 每个成员、分值按字符串对象相邻保存
    - 分值由double转为字符串，载入时自动转换
- INTSET编码和集合：
    - TYPE为`REDIS_RDB_TYPE_SET_INTSET`，将整数转为字符串，按字符串对象保存
- ZIPLIST编码的列表、哈希表、有序集合：
    - TYPE为`REDIS_RDB_TYPE_LIST|HASH|ZSET_ZIPLIST`，将压缩列表类型的value转为字符串对象

### 4、分析RDB文件

`od -cx dump.rdb` 以ASCII和16进制打开RDB文件 `redis-check-dump` 工具

## 三、AOF持久化

除了RDB持久化，Redis还提供AOF（Append Only File），通过保存所执行的写命令实现持久化。

### 1、实现

- 命令追加：服务器每执行完一个写命令，以协议格式将被执行的命令追加到redisServer的`aof_buf`缓冲区
- 写入与同步：
    - Redis服务器进程本质上是一个事件循环，其中文件事件负责处理客户端请求，时间事件负责执行`serverCron`这样定时运行的函数
        - 每结束一个事件循环，会调用`flushAppendOnlyFile`函数，决定是否将`aof_buf`写入AOF文件中
    - 同步行为由`appendfsync`选项值决定：
        - `always`：每次有数据修改发生时都会写入AOF文件。效率最慢，安全性最高
        - `everysec`：**默认**，每秒钟同步一次，显式地将多个写命令同步到硬盘。效率适中
        - `no`：由 OS 决定何时进行同步。效率最高安全性最差
- 载入数据：创建不带网络连接的伪客户端（上下文），读取、分析并执行AOF文件中的每一条命令。

### 2、AOF重写

为了避免大量写命令造成AOF文件体积过大，以及还原时间过长，需要用BGREWRITEAOF命令对AOF文件重写。

- 本质上并不读取旧AOF文件，而是创建一个新文件，直接读取数据库状态，然后将数据写入新AOF文件
- 为了避免客户端输入缓冲区溢出，处理列表,哈希表,集合,有序集合这四种可能会带有多个键,对于超过`REDIS_AOF_REWRITE_ITEMS_PER_CMD`数量的键，分多条命令写入
- Redis使用子进程执行重写
    - 优点：不阻塞服务器进程，且子进程带有服务器进程的数据副本，避免用锁保证数据安全
    - 问题：重写过程中与服务器进程的数据不一致性。
    - 解决方案：
        - 子进程执行重写的过程中，新的客户端命令不仅要追加到aof_buf，还要追加到`aof_rewrite_buf`
        - 子进程完成重写后，向服务器进程发送信号。由主进程将`aof_rewrite_buf`写入AOF文件，保证数据一致性
        - 最后以原子操作，将新AOF文件改名覆盖旧AOF文件

## 四、事件

Redis服务器是基于Reactor模式的事件驱动程序，主要处理两类事件：

- 文件事件：服务器与客户端通信，对套接字操作的抽象
- 时间事件：定时操作的抽象

### 1、文件事件

<center><img src="/image/redis/redis27.png"  style="zoom:33%;" /></center>

- 套接字：文件事件的抽象，每当一个套接字准备好执行连接应答、写入、读取、关闭等操作时，就会产生一个文件事件
    - 复用程序可以监听套接字的`AE_READABLE` | `AE_WRITABLE`事件
    - 也可以同时监听`AE_READABLE`、`AE_WRITABLE`，如果同时产生事件，服务器将先读后写
- I/O多路复用程序：负责监听多个套接字，并向文件事件分派器传送那些产生了事件的套接字
    - 所有产生事件的套接字都会放到一个队列里，然后以有序、同步、每次一个套接字的方式传送套接字
    - 当上一个套接字产生的事件被处理完毕之后，才会继续传送下一个套接字
    - 实现上通过包装常见的I/O多路复用库，如select, epoll, evport, kqueue等，且提供相同的API，编译时自动选择性能最高的函数库
- 文件事件分派器：接收I/O多路复用程序传来的套接字，并根据套接字产生的事件的类型调用相应的事件处理器
- 事件处理器：与不同任务的套接字关联的一个个函数，定义了某个事件发生时服务器应该执行的动作。常用的有三类：
    - 连接应答处理器：acceptTcpHandler函数，用于对连接服务器监听套接字的客户端进行应答
    - 命令请求处理器：readQueryFromClient函数，负责从套接字中读入客户端发送的命令请求内容
    - 命令回复处理器：sendReplyToClient函数，负责将服务器执行命令后得到的回复通过套接字返回给客户端

<center><img src="/image/redis/redis28.png"  style="zoom:33%;" /></center>

### 2、时间事件

一个时间事件主要有三个属性组成：

- id：服务器为时间事件创建的全局唯一ID。ID从小到大递增
- when：毫秒精度的UNIX时间戳，记录了时间事件的到达时间
- timeProc：时间事件处理器，一个函数。当时间事件到达时，服务器就会调用相应的处理器来处理事件

Redis的时间事件分定时事件和周期性事件两类，目前仅使用周期性事件。类型取决于处理器的返回值：

- AE_NOMORE：定时事件，到达一次后就删除
- 非AE_NOMORE 周期性事件，根据返回值对事件的when属性更新，继续运行

实现上，服务器将所有时间事件放在一个无序链表（不按when属性排序，按id）中，每当时间事件执行器运行时，遍历整个链表，查找已到达的事件并调用相应的处理器。不过目前Redis仅有serverCron一个时间事件，因此实际上该链表仅一个节点。serverCron函数的工作包括：

- 更新服务器的各类统计信息，比如时间、内存占用、数据库占用情况等。
- 清理数据库中的过期键值对。
- 关闭和清理连接失效的客户端。
- 尝试进行AOF或RDB持久化操作。
- 如果服务器是主服务器，那么对从服务器进行定期同步。
- 如果处于集群模式，对集群进行定期同步和连接测试。

### 3、事件的调度与执行

<center><img src="/image/redis/redis29.png"  style="zoom:33%;" /></center>

- 等待文件事件产生调用的是aeApiPoll，阻塞时间由到达时间最接近当前时间的时间事件决定，避免对时间事件频繁轮询也避免阻塞时间过长
- 文件事件是随机出现的，如果处理完一次文件事件，没有时间事件到达，将再次等待处理文件事件
- 对事件的处理都是同步、有序、原子的，不会中断也不会抢占。但都会尽量减少阻塞时间，并在需要时让出执行权
- 时间事件在文件事件之后，且不会抢占，因此时间事件的实际执行通常比设定时间稍晚一些

## 五、客户端

Redis是一对多的服务器程序，通过I/O多路复用实现单线程单进程处理所有客户端的命令请求。redisServer中的clients指针指向了保存所有客户端状态的redisClient结构数组。

### 1、通用属性

- fd: 客户端正在使用的套接字描述符
    - 值 -1 表示伪客户端，包括AOF载入和Lua脚本两种场景
    - 大于-1的整数即普通客户端
- name: 通过`CLIENT name xxx`设置，让客户端身份更清晰
- flags：各种状态信息标志位
- querybuf：输入缓冲区，根据输入动态调节，最大1GB
- argv、argc：命令参数和数量
- cmd：命令函数，redisCommand类型
- buf、bufpos：固定大小的输出缓冲区和已使用大小，保存长度较小的回复
- reply：可变大小的输出缓冲区，链表结构，保存长度较大的回复
- authenticated：身份认证，0未通过，1通过。未通过时除AUTH命令外都会被拒绝执行
- ctime：客户端创建时间
- lastinteraction：上一次交互时间
- obuf_soft_limit_reached_time：输出缓冲区第一次到达软性限制的时间
    - 服务器使用两种模式限制输出缓冲区大小，一种硬限制，超过即关闭客户端
    - 另一种是软限制，超过后继续监测，如果持续一段时间（配合readched_time）一直超过则关闭。

### 2、创建与连接

- 普通客户端：
    - 创建：通过网络连接，创建相应的redisClient，加入服务器状态的clients链表末尾
    - 关闭：进程结束、请求不符合协议、KILL、timeout、I/O缓冲区溢出...
    - 注意:为了避免客户端回复过大,占用过多服务器资源,服务器会时刻检查客户端的输出缓冲区大小,并在缓冲区的大小超出范围时执行相应的限制操作
        - 硬性限制:如果缓冲区大小超过硬性限制所设置的大小,会立刻关闭客户端
        - 软性限制:只有一直超出软性限制并且持续时间超出服务器设置的时长才会关闭客户端,如果缓冲区大小在指定时间内不再超出软性限制就不会关闭客户端
- Lua伪客户端：服务器初始化时创建负责执行Lua脚本的伪客户端，关联在redisServer/lua_client属性中，直到服务器销毁时才会关闭。
- AOF伪客户端：服务器载入AOF文件时，会创建用于执行AOF文件的伪客户端，载入完成后关闭。

## 六、服务器

### 1、命令执行过程

- 发送命令请求：用户键入命令请求，客户端将其转换成协议格式，然后通过连接套接字发送给服务器
- 读取命令请求：
    - 服务器读取套接字中的请求，保存到redisClient的输入缓冲区
    - 分析缓冲区内的请求，提取命令参数及个数，保存到argv、argc
    - 调用命令执行器，执行指定命令
- 发送命令回复：
    - 命令实现函数将回复保存在redisClient的输出缓冲区
    - 服务器通过命令回复处理器，将回复发送给客户端，并清空缓冲区
- 接收命令回复：客户端接收回复并转换协议，打印出结果

### 2、命令执行过程

根据redisClient的argv[0]在命令表中查找命令实现，即redisCommand结构，记录至cmd属性。主要属性有：

- name, proc实现函数, arity参数个数, sflags标记位, calls执行次数, milliseconds执行时长...

<center><img src="/image/redis/redis30.png"  style="zoom:33%;" /></center>

- 执行预备操作：检查cmd非NULL，检查命令参数，身份验证，内存占用，持久化/订阅/Lua/监视器等检查工作
- 调用命令实现函数：
    - 调用redisClient->cmd->proc(client)
    - 执行结果保存至输出缓冲区（buf/reply）
    - 为客户端套接字关联回复处理器
- 执行后续工作：
    - 跟新慢查询日志
    - 更新redisClient相关属性
    - AOF同步
    - 主从同步

### 3、serverCron函数

1. 更新服务器时间缓存，redisServer/unixtime、mstime
    - serverCron每100ms执行一次，因此时间精度不高
    - 仅用于对时间精度要求不高的功能，如打印日志、更新LRU时钟等
    - 而需要高精度时间的任务，如设置过期时间、添加慢查询日志等，仍然执行系统调用获取准确时间
2. 更新LRU时钟：对象最后一次被访问时间，估算值
3. 更新服务器每秒执行命令次数：INFO status 命令的 instantaneous_ops_per_sec 属性，实现上是采样平均得到的估算值
4. 更新服务器内存峰值记录：redisServer/stat_peak_memory
5. 处理SIGTERM结束服务器信号,关闭之前会进行RDB持久化
6. 管理客户端资源：释放超时的客户端连接、重置溢出的客户端输入缓冲区
7. 管理数据库资源：删除过期键、收缩字典
8. 执行被延迟的BGREWRITEAOF
9. 检查持久化操作的运行状态：redisServer/rdb_child_pid, aof_child_pid记录执行持久化的子进程

<center><img src="/image/redis/redis31.png"  style="zoom:33%;" /></center>

11. 同步AOF文件

12. 关闭输出缓冲区溢出的客户端

13. 增加cronloops计数器，记录serverCron执行次数

### 4、初始化服务器

- 初始化服务器状态结构：initServerConfig函数
    - 设置服务器运行id、频率、配置文件路径、架构、端口、持久化条件，初始化LRU时钟，并创建命令表
- 载入配置选项：通过给定配置参数/配置文件，修改服务器的默认配置
- 初始化服务器数据结构：initServer函数
    - server.clients: redisClient数组
    - server.db: 数据库结构数组
    - server.pubsub_channels/patterns: 保存频道订阅信息的字典、保存模式订阅信息的链表
    - server.lua: 执行Lua脚本的Lua环境
    - server.slowlog: 保存慢查询日志的结构
    - 其它操作：设置进程信号处理器、创建共享对象、打开监听端口、创建时间事件、AOF持久化、初始化后台I/O
- 还原数据库状态：如果启用AOF，则用AOF文件还原，否则使用RDB文件
- 执行事件循环：可以开始接收客户端连接和请求
