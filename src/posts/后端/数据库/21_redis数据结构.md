---
title: Redis数据结构
date: 2024-11-26 16:14:58
tags: redis
category: 数据库
order: 21
icon: "/img/redis.svg"
---

<!--more-->

# Redis数据结构

## 一、简单动态字符串

Redis中保存的Key是字符串，value往往是字符串或者字符串的集合。可见字符串是Redis中最常用的一种数据结构。不过Redis没有直接使用C语言中的字符串，而只会**使用C字符串作为字面量**,因为C语言字符串存在很多问题：

- 获取字符串长度的需要通过运算
- 非二进制安全
- 不可修改

Redis构建了一种新的字符串结构，称为**简单动态字符串（Simple Dynamic String），简称SDS**。

Redis是C语言实现的，其中SDS是一个结构体，源码如下：

```c
struct sdshdr{
  //记录buf数组中已使用的字节的数量
  //等于SDS所保存字符串的长度
  int len;
  
  //记录buf数组中未使用的字节的数量
  int free;
  
  //字节数组,用于保存字符串
  char buf[];
}
```

<center><img src="/image/redis/redis1.png"  style="zoom:50%;" /></center>

- len：记录buf数组中已使用字节数，等于SDS保存字符串的长度
- free：记录buf数组中未使用字节数
- buf：字节数组用于保存字符串

::: tip SDS与C字符串的区别

- 1、**常数复杂度获取字符串长度**: SDS额外记录了字符串长度，因此获取字符串长度的复杂度由O(n)缩小为O(1)
- 2、**杜绝缓冲区溢出**: 存储数据的buf数组实现了内存自动重分配，杜绝了缓冲区溢出
- 3、**减少修改字符串时带来的内存重分配次数**
    - **空间预分配**：对SDS修改需要扩展空间时，Redis会为SDS分配额外空间
        - 如果修改后len < 1MB，则额外分配len长度的free空间，即len=free
        - 如果修改后len > 1MB，则额外分配1MB的free空间
    - **惰性空间释放**：SDS需要缩短字符串时，并不立即回收多余空间，而是先记录到free字段中，等有需要时再真正释放。减少了耗时的重分配操作
- 4、**二进制安全**: Redis使用len标记字符串长度，而不是根据空字符，因此可以保存任意格式二进制数据
- 5、**兼容部分C字符串**: 在存储上仍然在字符末尾加上`\0`空字符，可以兼容部分C字符串函数

:::

## 二、链表

链表在Redis中使用非常广泛,比如列表键的底层实现之一就是链表,除此之外,发布与订阅,慢查询,监视器等功能也用到了链表,Redis服务器本身还使用链表来保存多个客户端的状态信息,以及使用链表来构建客户端输出缓冲区(output buffer).

**链表和链表节点的实现:**

```c
//链表节点
typedef struct listNode{
  //前置节点
  struct listNode *prev;
  
  //后置节点
  struct listNode *next;
  
  //节点的值
  void *value;
}listNode;

//链表
typedef struct list{
  //表头节点
  listNode *head;
  //末尾节点
  listNode *tail;
  //链表所包含的节点数量
  unsigned long len;
  //节点值复制函数
  void *(*dup)(void *ptr);
  //节点值释放函数
  void (*free)(void *ptr);
  //节点值对比函数
  int (*match)(void *ptr, void *key);
}list;
```

- dup、free 和 match 成员是用于实现多态链表所需的类型特定函数
    - dup 函数用于复制链表节点所保存的值
    - free 函数用于释放链表节点所保存的值
    - match 函数用于对比链表节点所保存的值和另一个输入值是否相等

下图是由一个list结构和三个listNode结构组成的链表

<center><img src="/image/redis/redis2.png"  style="zoom:50%;" /></center>

**特性:**

- 双端、无环、带表头表尾指针、带长度计数器
- 支持多态，dup、free、match三个void*指针字段可以设置特殊类型函数，用于保存不同类型的值。

## 三、字典

### 1、实现

Redis的字典使用哈希表作为底层实现,一个哈希表里面可以有多个哈希表节点,而每个哈希表节点就保存来字典中的一个键值对.

```c
//哈希表
typedef struct dictht{
  //哈希表数组
  dictEntry **table;
  //哈希表大小
  unsigned long size;
  //哈希表大小掩码,用于计算索引值
  //总是等于size-1
  unsigned long sizemask;
  //该哈希表已有节点数量
  unsigned long used;
}dictht;

//哈希表节点
typedef struct dictEntry{
  //键
  void *key;
  //值
  union{
    void *val;
    unint64_t u64;
    int64_t s64;
  }
  //指向下一个哈希表节点,形成链表
  struct dictEntry *next;
}dictEntry;

//字典
typedef struct dict{
  //类型特定函数
  dictType *type;
  //私有数据
  void *privdata;
  //哈希表
  dictht ht[2];
  //rehash索引
  //当rehash不在进行时,值为-1
  int trehashidx;
}dict;
```

<center><img src="/image/redis/redis3.png"  style="zoom:50%;" /></center>

- 哈希表结点 - dictEntry
    - key-value结构，其中value可以是指针、uint64_t、int64_t
    - next：指向同索引的下一个结点（链地址法解决哈希冲突）
- 哈希表- dictht
    - table：数组，存储哈希表节点指针
    - size：记录表的大小
    - sizemask：用于和哈希值计算应该放置的索引
    - used：已有的结点数量
- 字典 - dict
    - dictType：存储类型特定函数，用于实现多态
    - privdata：保存类型特定函数所需参数
    - ht：两个哈希表的数组，一般只使用ht[0]，ht[1]用于Rehash
    - rehashidx：是否在Rehash，不是则置-1

### 2、哈希算法

当要将一个新的键值对添加到字典里面时,程序需要先根据键值对的键计算出哈希值和索引值,然后根据索引值,将包含新键值对的哈希表节点放到哈希表数组的指定索引上面.

```c
// 使用字典设置的哈希函数,计算键key的哈希值
hash = dict->type->hashFunction(key);

//使用哈希表的sizemask属性和哈希值,计算出索引
//根据情况不同,ht[x]可以是ht[0]或者ht[1]
index = hash & dict->ht[x].sizemask
```

Redis使用`MurmurHash2`算法，具有很好的随机分布性和计算速度

- 链地址法解决哈希冲突，且新节点总是添加到链表的表头以加快速度
- Rehash：哈希结点过多或过少时，需要调整哈希表的大小
    - 调整条件：
        - 扩展：服务器目前没有在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于1。
        - 扩展：服务器目前正在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于5。
        - 收缩：服务器目前正在执行BGSAVE命令或者BGREWRITEAOF命令，并且哈希表的负载因子大于等于5。
    - 调整大小：
        - 如果是扩展，那么ht[1]的大小为第一个$>=ht[0].used*2 \ \text{的} \ 2^n$
        - 如果是收缩，那么ht[1]的大小为第一个$>=ht[0].used \ \text{的} \ 2^n$
    - 调整步骤：
        - 1. 为ht[1]分配空间，大小计算如上
        - 1. 将ht[0]中的所有键值对重新计算哈希值和索引值，放入ht[1]
        - 1. 迁移完成后，释放ht[0]，将ht[1]设置为ht[0]，并为ht[1]创建新的空白哈希表，为下一次rehash做准备
- 渐进式Rehash：为了避免一次性大量rehash对服务器性能造成影响，需要分多次、渐进rehash。
    - 渐进方式：
        - 1. 为ht[1]分配空间，让字典同时持有ht[0]和ht[1]两个哈希表。
        - 1. 维护索引计数器变量`rehashidx`置0，表示rehash开始。
        - 1. rehash开始后，每次对字典执行添加、删除、查找或更新操作时，程序除了执行指定操作外，还会顺带将ht[0]哈希表在rehashidx索引上的所有键值对rehash到ht[1]，完成后将rehashidx属性的值增一。
        - 1. 随着字典操作的不断执行，最终ht[0]的所有键值对都会被rehash至ht[1]，这时将rehashidx属性的值置-1，表示rehash操作完成。
    - rehash期间的查找需要先后在ht[0]、ht[1]中查找
    - rehash期间的添加一律保存至ht[1]，保证ht[0]键值对只减不增
    - 渐进式采取分而治之的方式，将rehash键值对所需的计算工作均摊到对字典的每个添加、删除、查找和更新操作上，从而避免了集中式rehash而带来的庞大计算量。

## 四、跳跃表

### 1、概念

- 跳表是一种有序数据结构，在每个节点中维持多个指向其它节点的指针，从而快速访问结点。
- 跳表效率与平衡树相当，且实现简单。
- Redis中跳表的作用有两个，一是有序集合的底层实现之一，二是集群节点中用作内部数据结构。

<center><img src="/image/redis/redis4.png"  style="zoom:50%;" /></center>

### 2、实现

<center><img src="/image/redis/redis5.png"  style="zoom:50%;" /></center>

- zskiplist：维护跳表相关信息，提高效率
    - header: 指向跳表表头结点
    - tail：指向跳表表尾结点
    - level：跳表结点的最大层数
    - length：跳表长度，即结点数量
- zskiplistNode：跳表结点
    - 层：level类型数组，其中每个元素指向其它结点以加快访问。创建新结点时，根据幂次定律随机生成介于1~32之间的值作为结点层数。level类型有两个字段：
        - 前进指针：指向下一个结点，可以一次跳过多个结点
        - 跨度：记录两个结点的距离
            - 结点跨度越大，逻辑上相距越远
            - 指向NULL的前进指针跨度为0
            - 用于计算排位
    - 后退节点：指向前驱结点，每次只能后退一步
    - 分值：double型浮点数，跳表中的结点按分值从小到大排序
    - 成员：对象指针，指向一个SDS。成员在跳表中唯一，分值相同的结点按成员字典序排序

## 五、整数集合

整数集合`intset`是集合键的底层实现之一，有序且不重复。

### 1、实现

<center><img src="/image/redis/redis6.png"  style="zoom:50%;" /></center>

- encoding: 编码方式，包括 uint16_t / uint32_t / uint64_t 三种
- length: 元素数量，即contents数组长度
- contents：保存元素的数组
    - 虽然声明是uint8_t，实际类型取决于encoding
    - 所有元素类型保持一致
    - 元素从小到大，无重复排序

### 2、升级

当添加一个新元素时，如果新元素类型比现有的所有元素类型都长，整数集合需要先升级。

- 策略 - 复杂度O(n)：
    - 1. 根据新元素类型，扩展整数集合底层数组的空间大小，并为新元素分配空间
    - 1. 将现有的所有元素都转换成与新元素相同的类型，并将类型转换后的元素放置到正确的位上，保持有序
    - 1. 将新元素添加到底层数组里面（新元素要么最大置数组头，要么最小置数组尾）
- 优点：提升了整数集合的灵活性，也节约了内存
- 整数集合不支持降级

## 六、压缩列表

压缩列表是列表键和哈希键的底层实现之一.当一个列表键只包含少量列表项,并且每个列表项要么是小整数值,要么是长度比较短的字符串,那么Redis就会使用压缩列表来做列表键的底层实现.

### 1、实现

<center><img src="/image/redis/redis7.png"  style="zoom:50%;" /></center>

<center><img src="/image/redis/redis8.png"  style="zoom:50%;" /></center>

### 2、列表节点

<center><img src="/image/redis/redis9.png"  style="zoom:50%;" /></center>

- 每个Entry保存一个字节数组或一个整数值，由previous_entry_length, encoding, content三部分组成
    - 如果是字节数组，分三种：
        - 长度$<=(2^6-1)$的字节数组
        - 长度$<=(2^{14}-1)$的字节数组
        - 长度$<=(2^{32}-1)$的字节数组
    - 如果是整数值，分6种：
        - 4位长，介于0~12的无符号整数
        - 1字节长有符号整数
        - 3字节长有符号整数
        - int16_t类型整数
        - int32_t类型整数
        - int64_t类型整数
- previous_entry_length: 前一个结点的长度，占1字节/5字节。可以结合当前结点地址计算出前一节点的起始地址
    - 如果前一节点长度小于254，则占1字节
    - 如果前一节点长度大于等于254，则占5字节，其中第一个字节置为0xFE作为标记
- encoding：记录content属性的类型及长度
    - 如果最高位为00/01/10，则占1/2/5字节，表示content存储字节数组，数组的长度由其余位记录
    - 如果最高位为11，则占1字节，表示content存储整数值，类型和长度由其余位记录（值甚至可能直接保存在encoding中）
- content：保存节点值，可能是字节数组/整数值

### 3、连锁更新

如果压缩列表里恰好有多个连续的，长度介于250-253字节的数组，在增删改时可能引发连锁更新，导致连续的空间重分配，最坏复杂度$O(N^2)$。但实际情况下很少发生。

## 七、对象

### 1、对象类型和编码

- Redis使用对象来表示数据库中的键和值，包含字符串对象、列表对象、哈希对象、集合对象、有序集合对象五种类型

- 每种对象都使用了前述的至少一种数据结构（SDS，链表，字典，跳表，整数集合，压缩列表）

- 每个对象都由一个redisObject结构表示
    
    - ```c
        typedef struct redisObject{
          //类型
          unsigned type:4;
          //编码
          unsigned encoding:4;
          //指向底层实现数据结构的指针
          void *ptr
          //...
        }robj;
        ```
    
    - type：对象类型
        - Redis中键总是一个字符串对象，而值可以是五种对象中任意一种
    
        - 使用`type key`命令输出对象类型
    
        - <center><img src="/image/redis/redis10.png"  style="zoom:50%;" /></center>
    
    - encoding：记录对象所使用的数据结构
    
        - 每种对象都至少使用了两种不同实现结构
    
        - Redis可以根据不同使用场景切换使用不同实现方式，提升了灵活性和效率
    
        - 使用`object encoding key`命令输出对象编码
    
        <center><img src="/image/redis/redis11.png"  style="zoom:50%;" /></center>
    
    - ptr：指向对象的底层实现数据结构

### 2、字符串对象

字符串对象是唯一一种会被其他四种类型嵌套的对象

- 字符串对象的编码有三种：
    - int：可以用long类型保存的整数
    - embstr：长度 $<=32Bytes$ 的短字符串
    - raw：长度 $>32Bytes$ 的长字符串，或无法用long保存的整数，或无法用long double保存的浮点数

<center><img src="/image/redis/redis12.png"  style="zoom:50%;" /></center>

- embstr与raw编码联系：
    - 两者都使用redisObject和sdshdr结构表示字符串编码
    - raw分两次内存分配给两个结构，而embstr一次性分配连续的内存空间给两个结构。相应的释放内存次数也不同
    - embstr连续存储能够更好的利用缓存带来的优势

- 编码转换：int/embstr在某些条件下会自动转换为raw编码的字符串对象
    - 对于int，如果执行了一些操作，不再是整数或超出long范围，则会转换为raw
    - 对于embstr，本身是只读对象，没有相应的操作。因此任何对embstr的修改操作，都会使其转换为raw

### 3、列表对象

列表对象的编码可以是`ziplist`和`linkedlist`

- `ziplist`:使用压缩列表实现，每个压缩列表结点保存一个列表元素

<center><img src="/image/redis/redis13.png"  style="zoom:50%;" /></center>

- `linkedlist`: 使用双端链表作为底层实现,每个双端链表节点(node)都保存来一个字符串对象,而每个字符串对象都保存来一个列表元素

<center><img src="/image/redis/redis14.png"  style="zoom:50%;" /></center>

**编码转换**：当列表对象同时满足以下两个条件时，使用 ziplist，否则 linkedlist（参数可调）

- 列表对象保存的所有字符串元素的长度都小于64Byte
- 列表对象保存的元素数量小于512

### 4、哈希对象

哈希对象的编码有两种：

- ziplist：使用压缩列表实现

    - 新加入的键和值分别保存在一个压缩列表结点中，推入列表表尾

    <center><img src="/image/redis/redis15.png"  style="zoom:50%;" /></center>

- hashtable：使用字典实现
    - 字典的每个键都是一个字符串对象，保存键
    - 字典的每个值都是一个字符串对象，保存值

<center><img src="/image/redis/redis16.png"  style="zoom:50%;" /></center>

**编码转换**：当哈希对象同时满足以下两个条件时，使用 ziplist，否则 hashtable（参数可调）

- 哈希对象保存的所有键、值的字符串长度都小于64Byte
- 哈希对象保存的键值对数量小于512

### 5、集合对象

集合对象的编码有两种：

- intset：使用整数集合实现

    - 所有元素保存在整数集合中

    <center><img src="/image/redis/redis17.png"  style="zoom:50%;" /></center>

- hashtable：使用字典实现

    - 字典的每个键都是一个字符串对象，保存一个集合元素
    - 字典的每个值都是NULL

<center><img src="/image/redis/redis18.png"  style="zoom:50%;" /></center>

**编码转换**：当集合对象同时满足以下两个条件时，使用 intset，否则 hashtable（参数可调）

- 集合对象保存的所有元素都是整数值
- 集合对象保存的元素数量不超过512个

### 6、有序集合对象

有序集合每个元素的成员都是一个字符串对象，而每个元素的分值都是一个double

有序集合对象的编码有两种：

- ziplist：使用压缩列表实现
    - 每个元素使用两个紧挨在一起的压缩列表节点保存，第一个是元素成员，第二个是元素分值
    - 压缩列表内的集合元素按分值从小到大排序

<center><img src="/image/redis/redis19.png"  style="zoom:50%;" /></center>

- skiplist：使用zset-跳表+字典实现

    - 跳表按分值从小到大保存所有集合元素

    - 跳表的每个结点保存一个集合元素，object存储成员，score存储分值

    - 跳表可以实现有序集合的范围型操作

    - 字典创建了从成员到分值的映射

    - 字典的每个键值对保存一个集合元素，键是成员，值是分值

    - 字典可以实现$O(1)$查找指定元素分值

    - 尽管可以单独用跳表或字典实现有序集合，但不能同时满足范围型操作和查找操作的效率

    - 跳表和字典通过指针共享相同的元素，不额外浪费内存

<center><img src="/image/redis/redis20.png"  style="zoom:50%;" /></center>

编码转换：当有序集合对象同时满足以下两个条件时，使用 ziplist，否则 skiplist（参数可调）

- 有序集合保存的元素数量小于128个
- 有序集合保存的所有元素成员的长度都小于64字节

### 7、对象其它属性

- 类型检查：
    - Redis部分命令适用于任何类型键，如DEL, EXPIRE...；称基于类型的多态命令
    - 另一部分只能用于特定类型，如HSET, SADD...；称基于编码的多态命令
    - 服务器根据redisObject中的type属性检查操作是否适用
    - 服务器根据redisObject中的encoding属性检查操作的具体实现
- RefCount：
    - 对象周期分创建、操作、释放三个
    - Redis使用引用计数机制实现内存自动回收，由redisObject中的refCount记录引用数
    - 基于refCount，相同整数值的字符串对象可以进行共享，节约内存
    - Redis自动对0-9999的整数值进行共享
    - 考虑到值判等的开销，仅对包含整数值的字符串对象进行共享
- LRU：
    - redisObject中的lru属性记录对象最后一次被访问的时间，用于LRU内存回收策略
    - 也用于idletime计算空转时间
