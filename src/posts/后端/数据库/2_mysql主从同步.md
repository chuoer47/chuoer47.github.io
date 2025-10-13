---
title: MySQL主从同步
date: 2024-06-11 16:24:22
tag: mysql
category: 数据库
icon: "/img/mysql.svg"
order: 2
---

<!--more--->

# MySQL主从同步详解

## 一、原理

MySQL的主从复制涉及到三个线程，一个运行在主节点（log dump thread），其余两个(I/O thread, SQL thread)运行在从节点，如下图所示:

![](/image/mysql1.png)

- 主节点 binary log dump 线程
  当从节点连接主节点时，主节点会创建一个log dump 线程，用于发送bin-log的内容。在读取bin-log中的操作时，此线程会对主节点上的bin-log加锁，当读取完成，甚至在发动给从节点之前，锁会被释放。
- 从节点I/O线程
  当从节点上执行start slave命令之后，从节点会创建一个I/O线程用来连接主节点，请求主库中更新的bin-log。I/O线程接收到主节点binlog dump 进程发来的更新之后，保存在本地relay-log中。
- 从节点SQL线程
  SQL线程负责读取relay log中的内容，解析成具体的操作并执行，最终保证主从数据的一致性。


:::tip 说明

1. 对于每一个主从连接，都需要三个进程来完成。当主节点有多个从节点时，主节点会为每个当前连接的从节点创建一个binary log dump
   进程，而每个从节点都有自己的I/O进程和SQL进程。
2. 从节点分别用I/O进程和SQL进程从主库拉取更新的日志和在本地回放执行SQL语句，这样在执行同步数据任务的时候，不会降低读操作的性能。
3. 要实施复制，必须打开Master 上的binary log（bin-log）功能，否则无法实现。

:::

## 二、复制过程

![](/image/mysql2.png)

::: info 过程

- 从节点上的I/O 进程连接主节点，并请求从指定日志文件的指定位置（或者从最开始的日志）之后的日志内容开始；
- 主节点接收到来自从节点的I/O请求后，通过负责复制的I/O进程根据请求信息读取指定日志指定位置之后的日志信息，返回给从节点。返回信息中包括本次返回的信息的bin-log file 和 bin-log position；从节点的I/O进程接收到内容后，将接收到的日志内容更新到本机的relay log中，并将读取到的binary log文件名和位置保存到master-info文件中（此文件好像没有了，有可能被别的文件代替了），以便在下一次读取的时候能够清楚的告诉Master需要从某个bin-log 的哪个位置开始往后的日志内容再次读取；
- Slave 的 SQL线程检测到relay-log
  中新增加了内容后，会将relay-log的内容解析成在祝节点上实际执行过的操作，并在本数据库中执行。

:::

## 三、复制方式

MySQL 主从复制默认是异步的模式。MySQL增删改操作会全部记录在binary log中，当slave节点连接master时，会主动从master处获取最新的bin log文件，并把bin log中的sql 通过I/O relay到本地。

### 1、异步模式（mysql async-mode）

这种模式下，主节点不会主动push bin log到从节点，这样有可能导致failover的情况下，也许从节点没有及时的将最新的bin log同步到本地。

![](/image/mysql3.png)

### 2、半同步模式(mysql semi-sync)

这种模式下主节点只需要接收到其中一台从节点的返回信息，就会commit；否则需要等待直到超时时间然后切换成异步模式再提交；这样做的目的可以使主从数据库的数据延迟缩小，可以提高数据安全性，确保了事务提交后，binlog至少传输到了一个从节点上，不能保证从节点将此事务更新到db中。性能上会有一定的降低，响应时间会变长。如下图所示：
![](/image/mysql4.png)

::: warning 

半同步模式不是mysql内置的，从mysql 5.5开始集成，需要master 和slave 安装插件开启半同步模式。

:::

### 3、全同步模式

全同步模式是指主节点和从节点全部执行了commit并确认才会向客户端返回成功，原理同半同步。

## 四、binlog记录格式

::: tip  MySQL 主从复制有三种方式：

- 基于SQL语句的复制（statement-based replication，SBR）

- 基于行的复制（row-based replication，RBR)

- 混合模式复制（mixed-based replication,MBR)



对应的binlog文件的格式也有三种：

- STATEMENT

- ROW

- MIXED

:::

### 1、基于SQL语句的复制

Statement-base Replication (SBR)就是记录sql语句在bin log中，Mysql 5.1.4 及之前的版本都是使用的这种复制格式。

优点：只需要记录会修改数据的sql语句到binlog中，减少了binlog日质量，节约I/O，提高性能。

缺点：在某些情况下，会导致主从节点中数据不一致（比如sleep(),now()等）。

### 2、基于行的复制

Row-based Relication(RBR)是mysql master将SQL语句分解为基于Row更改的语句并记录在bin log中，也就是指记录哪条数据被修改了，修改成什么样。

优点：不会出现某些特定情况下的存储过程、或者函数、或者trigger的调用或者触发无法被正确复制的问题。

缺点：会产生大量的日志，尤其是修改table的时候会让日志暴增,同时增加bin log同步时间。也不能通过bin log解析获取执行过的sql语句，只能看到发生的data变更。

### 3、混合模式复制

Mixed-format Replication(MBR)，MySQL NDB cluster 7.3 和7.4 使用的MBR。

是以上两种模式的混合，对于一般的复制使用STATEMENT模式保存到binlog，对于STATEMENT模式无法复制的操作则使用ROW模式来保存，MySQL会根据执行的SQL语句选择日志保存方式。

### 4、GTID复制模式

- 在传统的复制里面，当发生故障，需要主从切换，需要找到binlog和pos点，然后将主节点指向新的主节点，相对来说比较麻烦，也容易出错。在MySQL 5.6里面，不用再找binlog和pos点，我们只需要知道主节点的ip，端口，以及账号密码就行，因为复制是自动的，MySQL会通过内部机制GTID自动找点同步。

- 在MySQL 5.6以前的版本，slave的复制是单线程的。一个事件一个事件的读取应用，而master是并发写入的，所以延时是避免不了的。唯一有效的方法是把多个库放在多台slave，这样又有点浪费服务器。在MySQL 5.6里面，我们可以把多个表放在多个库，这样就可以使用多线程复制。


::: info 基于GTID复制实现的工作原理

1. 主节点更新数据时，会在事务前产生GTID，一起记录到binlog日志中；
2. 从节点的I/O线程将变更的bin log，写入到本地的relay log中；
3. SQL线程从relay log中获取GTID，然后对比本地binlog是否有记录（所以MySQL从节点必须要开启binary log）；
4. 如果有记录，说明该GTID的事务已经执行，从节点会忽略；如果没有记录，从节点就会从relay log中执行该GTID的事务，并记录到bin log；
5. 在解析过程中会判断是否有主键，如果没有就用二级索引，如果有就用全部扫描。

:::





## 参考：

[1] [https://blog.csdn.net/weixin_44729138/article/details/115311756](https://blog.csdn.net/weixin_44729138/article/details/115311756)