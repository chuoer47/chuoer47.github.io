---
title: MySQL高级一
date: 2024-11-21 16:14:58
category: 数据库
tag: mysql
icon: "/img/mysql.svg"
order: 15
---

<!--more--->

# MySQL高级一

## 一、基础

### 1、MySQL体系结构

<center><img src="/image/mysql/mysql3.png" alt="mysql体系结构" style="zoom: 33%;" /></center>

- 1、连接层
    - 最上层是一些客户端和链接服务，包含本地sock 通信和大多数基于客户端/服务端工具实现的类似于TCP/IP的通信。主要完成一些类似于连接处理、授权认证、及相关的安全方案。在该层上引入了线程池的概念，为通过认证安全接入的客户端提供线程。同样在该层上可以实现基于SSL的安全链接。服务器也会为安全接入的每个客户端验证它所具有的操作权限。

- 2、服务层
    - 第二层架构主要完成大多数的核心服务功能，如SQL接口，并完成缓存的查询，SQL的分析和优化，部分内置函数的执行。所有跨存储引擎的功能也在这一层实现，如 过程、函数等。在该层，服务器会解析查询并创建相应的内部解析树，并对其完成相应的优化如确定表的查询的顺序，是否利用索引等，最后生成相应的执行操作。如果是select语句，服务器还会查询内部的缓存，如果缓存空间足够大，这样在解决大量读操作的环境中能够很好的提升系统的性能。

- 3、引擎层
    - 存储引擎层， 存储引擎真正的负责了MySQL中数据的存储和提取，服务器通过API和存储引擎进行通信。不同的存储引擎具有不同的功能，这样我们可以根据自己的需要，来选取合适的存储引擎。数据库中的索引是在存储引擎层实现的。

-  4、存储层
    - 数据存储层， 主要是将数据(如: redolog、undolog、数据、索引、二进制日志、错误日志、查询日志、慢查询日志等)存储在文件系统之上，并完成与存储引擎的交互。

::: tip

和其他数据库相比，MySQL有点与众不同，它的架构可以在多种不同场景中应用并发挥良好作用。主要体现在存储引擎上，插件式的存储引擎架构，将查询处理和其他的系统任务以及数据的存储提取分离。这种架构可以根据业务的需求和实际需要选择合适的存储引擎。

:::

MySQL执行流程:

<center><img src="/image/mysql/mysql4.png" alt="mysql简化流程" style="zoom: 33%;" /></center>

- 连接器：负责跟客户端建立连接、获取权限、维持和管理连接
    - 用户名密码验证通过后，连接器会到权限表中查出所拥有的权限（因此修改权限不会立即生效） `mysql -uroot -p`
- 查询缓存(仅适用于不常修改的数据，且 MySQL 8 中已经删除缓存模块)
- 分析器：词法分析、语法分析，例如识别表名、列名等
- 优化器：存在多个索引时决定使用哪个索引，或多表关联时决定表的连接顺序，以确定语句的执行计划
- 执行器：校验权限后，真正执行语句，将执行结果存入结果集，最后返回

### 2、存储引擎

存储引擎就是存储数据、建立索引、更新/查询数据等技术的实现方式。存储引擎基于表而非基于库，因此也被称为表引擎。

相关语法：

```sql
-- 查询建表语句
show create table account;

-- 建表时指定存储引擎
CREATE TABLE 表名(
	...
) ENGINE=INNODB;

-- 查看当前数据库支持的存储引擎
show engines;
```

<center><img src="/image/mysql/mysql5.png" alt="mysql存储引擎" style="zoom: 33%;" /></center>

#### 1)InnoDB

InnoDB是一种兼顾高可靠性和高性能的通用存储引擎，在 MySQL 5.5 之后，InnoDB是默认的MySQL 存储引擎。

:::tip 特点

- DML操作遵循ACID模型，支持事务；

- 行级锁，提高并发访问性能；

- 支持外键FOREIGN KEY约束，保证数据的完整性和正确性；

:::

**文件:**

- xxx.ibd：xxx代表的是表名，innoDB引擎的每张表都会对应这样一个表空间文件，存储该表的表结构（frm-早期的 、sdi-新版的）、数据和索引。

- innodb_file_per_table 参数决定多张表共用一个系统表空间还是每张表独立表空间 `show variables like 'innodb_file_per_table';` 
    - 从idb文件提取表结构数据的工具： `ibd2sdi xxx.ibd`

#### 2)MyISAM

MyISAM是MySQL早期的默认存储引擎。

:::tip 特点

- 不支持事务，不支持外键

- 支持表锁，不支持行锁

- 访问速度快

:::

**文件:**

xxx.sdi：存储表结构信息

xxx.MYD: 存储数据

xxx.MYI: 存储索引

#### 3)Memory

Memory引擎的表数据时存储在内存中的，由于受到硬件问题、或断电问题的影响，只能将这些表作为临时表或缓存使用。

:::tip 特点

- 内存存放

- hash索引（默认）

:::

**文件:**

xxx.sdi：存储表结构信息

### 3、存储引擎区别和特点

|     特点     |       InnoDB        | MyISAM | Memory |
| :----------: | :-----------------: | :----: | :----: |
|   存储限制   |        64TB         |   有   |   有   |
|   事务安全   |        支持         |   -    |   -    |
|    锁机制    |        行锁         |  表锁  |  表锁  |
|  B+tree索引  |        支持         |  支持  |  支持  |
|   Hash索引   |          -          |   -    |  支持  |
|   全文索引   | 支持（5.6版本之后） |  支持  |   -    |
|   空间使用   |         高          |   低   |  N/A   |
|   内存使用   |         高          |   低   |  中等  |
| 批量插入速度 |         低          |   高   |   高   |
|   支持外键   |        支持         |   -    |   -    |

总结InnoDB和MyISAM的区别：

- InnoDB支持事务, 而MyISAM不支持
- InnoDB支持行锁和表锁, 而MyISAM仅支持表锁, 不支持行锁
- InnoDB支持外键, 而MyISAM不支持

### 4、存储引擎选择

- InnoDB : 如果应用对事物的完整性有比较高的要求，在并发条件下要求数据的一致性，数据操作除了插入和查询之外，还包含很多的更新、删除操作，则 InnoDB 是比较合适的选择
- MyISAM : 如果应用是以读操作和插入操作为主，只有很少的更新和删除操作，并且对事务的完整性、并发性要求不高，那这个存储引擎是非常合适的
- Memory : 将所有数据保存在内存中，访问速度快，通常用于临时表及缓存。Memory 的缺陷是对表的大小有限制，太大的表无法缓存在内存中，而且无法保障数据的安全性

::: warning

在选择存储引擎时，应该根据应用系统的特点选择合适的存储引擎。对于复杂的应用系统，还可以根据实际情况选择多种存储引擎进行组合。

:::

## 二、索引

### 1、索引概述

如果没有索引，只能依次遍历所有记录，效率十分低下。除了实际存储的数据，DBS 还维护着满足特定查找算法的数据结构，这些数据结构以某种方式引用（指向）数据，可以借此实现高效的查找算法。这种数据结构就是索引

优点：

- 提高数据检索效率，降低数据库的IO成本
- 通过索引列对数据进行排序，降低数据排序的成本，降低CPU的消耗

缺点：

- 索引列需要占用额外空间
- 索引大大提高了查询效率，但降低了增删改的速度

MySQL的索引是在**存储引擎层**实现的，不同的存储引擎支持不同的索引结构，主要包含以下几种：

| 索引结构            | 描述                                                         |    InnoDB     | MyISAM | Memory |
| ------------------- | ------------------------------------------------------------ | :-----------: | :----: | :----: |
| B+Tree              | 最常见的索引类型，大部分引擎都支持B+树索引                   |     支持      |  支持  |  支持  |
| Hash                | 底层数据结构是用哈希表实现，只有精确匹配索引列的查询才有效，不支持范围查询 |    不支持     | 不支持 |  支持  |
| R-Tree(空间索引)    | 空间索引是 MyISAM 引擎的一个特殊索引类型，主要用于地理空间数据类型，通常使用较少 |    不支持     |  支持  | 不支持 |
| Full-Text(全文索引) | 是一种通过建立倒排索引，快速匹配文档的方式，类似于 Lucene, Solr, ES | 5.6版本后支持 |  支持  | 不支持 |

注：如果没有特别指明，一般指`B+树`结构组织的索引。

### 2、索引结构

#### 1)B+树

- B+Tree是B-Tree的变种
- 非叶子节点仅作为索引，存储所指向的数据页中的最小键，不存储数据
- 叶子节点存储实际数据，且所有叶子节点形成一个单向链表

<center><img src="/image/mysql/mysql6.png"  style="zoom: 33%;" /></center>

- MySQL索引数据结构对经典的B+Tree进行了优化。每层节点按照索引值从小到大的顺序排序而组成了双向链表，每个页内的记录按索引列排序形成单链表。
- 所有结点本质上都是一个数据页，一页至少2条记录。目录项记录只存储主键值和对应的页号。
- 非叶子结点中的记录头`record_type`存1标识记录项记录，叶子结点中的记录头`record_type`存0标识数据记录
- 实际新增数据时，从根节点开始，存满后页分裂，向下生长树枝。因此根节点始终保持不动，并存储在数据字典中。
- 这种B+Tree提高了区间访问的性能，利于排序
- 另外，MyISAM中索引和数据分离，叶子节点存储的都是数据记录的地址，因此MyISAM的索引都是二级索引

<center><img src="/image/mysql/mysql7.png"  style="zoom: 50%;" /></center>

#### 2)Hash索引

- 哈希索引就是采用一定的hash算法，将键值换算成新的Hash值，映射到对应的槽位上，然后存储在Hash表中。
- 如果两个(或多个)键值，映射到一个相同的槽位上，他们就产生了Hash冲突（也称为Hash碰撞），可以通过链表来解决。
- 特点：
    - Hash索引只能用于对等比较`(=，in)`，不支持范围查询`(between，>，< ，...)`
    - 无法利用索引完成排序操作
    - 查询效率高，通常 (不存在hash冲突的情况下) 只需要一次检索，效率通常高于B+Tree索引
- 存储引擎支持：
    - Memory存储引擎支持Hash索引
    - InnoDB具有自适应Hash功能，其索引根据B+Tree索引在指定条件下自动构建

<center><img src="/image/mysql/mysql8.png"  style="zoom:50%;" /></center>

::: tip 总结

综上，InnoDB选择B+Tree索引结构的原因有：

- 相对于二叉树，层级更少，搜索效率高
- 相对于 B-Tree，无论是叶子节点还是非叶子节点，都会保存数据，导致一页中存储的键值减少，指针也跟着减少，需要保存大量数据时，只能增加树的高度，导致性能降低
- 相对于 Hash 索引，B+Tree 支持范围匹配及排序操作

:::

### 3、索引分类

- MySQL中，索引的具体类型主要分为以下几类：

    | 分类     | 含义                                                 | 特点                     |  关键字  |
    | -------- | ---------------------------------------------------- | ------------------------ | :------: |
    | 主键索引 | 针对于表中主键创建的索引                             | 默认自动创建，只能有一个 | PRIMARY  |
    | 唯一索引 | 避免同一个表中某数据列中的值重复                     | 可以有多个               |  UNIQUE  |
    | 常规索引 | 快速定位特定数据                                     | 可以有多个               |          |
    | 全文索引 | 全文索引查找的是文本中的关键词，而不是比较索引中的值 | 可以有多个               | FULLTEXT |

- InnoDB存储引擎中，根据索引的存储形式，又可以分为以下两种：

    | 分类                       | 含义                                                       | 特点                                       |
    | -------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
    | 聚集索引 (Clustered Index) | 将数据存储与索引放一块，索引结构的叶子节点直接保存了行数据 | 必须有且只有一个；索引即数据，数据即索引。 |
    | 二级索引 (Secondary Index) | 非主键生成的索引，索引结构的叶子节点关联的是对应的主键     | 可以存在多个；需要回表查询                 |

    聚集索引选取规则：

    - 如果存在主键，主键索引就是聚集索引
    - 如果不存在主键，将使用第一个唯一(UNIQUE)索引作为聚集索引
    - 如果表没有主键或没有合适的唯一索引，则使用 InnoDB 自动生成的`rowid`作为隐藏的聚集索引

<center><img src="/image/mysql/mysql9.png"  style="zoom:33%;" /></center>

- 聚集索引的叶子节点下挂的是这一行的数据
- 二级索引的叶子节点下挂的是该字段值对应的主键值（实际非叶子节点为了保证目录项唯一，也要保存主键值）
- **回表查询过程： 二级索引 -> 主键值 -> 聚集索引**

<center><img src="/image/mysql/mysql10.png"  style="zoom:33%;" /></center>

单列索引与联合索引

- 单列索引：即一个索引只包含单个列
- 联合索引：即一个索引关联多个列

:::tip 

在业务场景中，如果存在多个查询条件，考虑针对查询字段建立索引时，建议建立联合索引，而非单列索引。多条件联合查询时，MySQL优化器会评估哪个字段的索引效率更高，选择该索引完成本次查询。

:::

联合索引结构图：

<center><img src="/image/mysql/mysql11.png"  style="zoom:50%;" /></center>

### 4、索引语法

- 创建索引：
    `CREATE [ UNIQUE | FULLTEXT ] INDEX index_name ON table_name (index_col_name, ...);`
    如果 CREATE 后面不加索引类型参数，则创建的是常规索引
- 查看索引：
    `SHOW INDEX FROM table_name;`
- 删除索引：
    `DROP INDEX index_name ON table_name;`

示例：

```sql
-- name字段为姓名字段，该字段的值可能会重复，为该字段创建索引
create index idx_user_name on tb_user(name);

-- phone手机号字段的值非空，且唯一，为该字段创建唯一索引
create unique index idx_user_phone on tb_user (phone);

-- 为profession, age, status创建联合索引
create index idx_user_pro_age_stat on tb_user(profession, age, status);

-- 删除索引
drop index idx_user_name on tb_user;
```

### 5、索引使用

#### 1)最左前缀法则

- 联合索引遵守最左前缀法则，即查询从索引的最左列开始，并且不跳过索引中的列。
- 如果跳跃某一列，后面字段的排序就无法保证，因此后面字段的索引将失效。
- 最左前缀法则在select的时候，和字段书写的位置没有关系。
- 联合索引中，如果出现范围查询（<, >），其后的列索引将失效。可以用 >= 或者 <= 来规避索引失效问题。

例如，一个联合索引的顺序是 profession -> age -> status (创建索引时定义的顺序), 只要select没有选中某一列，那么其后的索引都将失效，即查询时不会使用该列之后的字段索引。

#### 2)索引失效情况

1. 在索引列上进行运算操作，索引将失效 如：`explain select * from tb_user where substring(phone, 10, 2) = '15';`
2. 字符串类型不加引号，索引将失效 如：`explain select * from tb_user where phone = 17799990015;`
3. 模糊查询中对头部模糊匹配，索引将失效 如：`explain select * from tb_user where profession like '%工程';`， 对前后都模糊匹配也会失效：`explain select * from tb_user where profession like '%工%';` 仅对尾部模糊匹配不会失效：`explain select * from tb_user where profession like '软件%';`
4. 用 or 连接的条件，左右两侧字段都有索引时，索引才会生效 因为只要有一个没有索引，另一个用不用索引没有意义，仍要进行全表扫描，所以无需用索引。
5. 数据分布的影响 如果 MySQL 评估使用索引比全表更慢，则不使用索引。因为索引是用来索引少量数据的，如果通过索引查询返回大批量的数据，则还不如走全表扫描来的快，此时索引就会失效。

#### 3)优化方案

**指定索引**

优化数据库的一个重要手段，在SQL语句中加入一些手动提示，优化MySQL的索引使用策略，以提升性能

- 建议使用索引 - use index `explain select * from tb_user use index(idx_user_pro) where profession="软件工程";`
- 忽略索引 - ignore index `explain select * from tb_user ignore index(idx_user_pro) where profession="软件工程";`
- 强制使用索引 - force index `explain select * from tb_user force index(idx_user_pro) where profession="软件工程";`

**覆盖索引**

应尽量使用覆盖索引，减少 `select *`。即需要查询的数据在单个索引结构中能够全部获取到，避免回表查询

explain 执行计划中 extra 字段含义：

- `using index condition`：查找使用了索引，但是需要回表查询数据
- `using where; using index;`：查找使用了索引，但是需要的数据都在索引列中能找到，不需要回表查询。因此性能更高

### 6、索引设计原则

1. 针对数据量较大，且查询比较频繁的表建立索引
2. 针对常作为查询条件（where）、排序（order by）、分组（group by）操作的字段建立索引
3. 考虑列的基数(区分度)，最好为基数大的列建立索引
4. 索引列的类型尽量小
5. 如果是字符串类型的字段，字段长度较长，可以针对字段的特点，建立前缀索引
6. 尽量使用联合索引，减少单列索引。查询时，联合索引很多时候可以覆盖索引，节省存储空间，避免回表，提高查询效率
7. 避免冗余和重复索引，索引并不是多多益善，索引越多，维护索引结构的代价就越大，会影响增删改的效率
8. 如果索引列不能存储NULL值，请在创建表时使用NOT NULL约束它。当优化器知道每列是否包含NULL值时，它可以更好地确定哪个索引最有效地用于查询
9. 主键按序插入能够提高性能，最好定义auto_increment

## 三、SQL优化

### 1、SQL性能分析

#### 1)**SQL**执行频率

MySQL 客户端连接成功后，通过 show [session|global] status 命令可以提供服务器状态信息。通过如下指令，可以查看当前数据库的INSERT、UPDATE、DELETE、SELECT的访问频次：

```sql
-- session 是查看当前会话 ;
-- global 是查询全局数据 ;

SHOW GLOBAL STATUS LIKE 'Com_';
```

Com_delete: 删除次数、Com_insert: 插入次数、Com_select: 查询次数、Com_update: 更新次数

#### 2)慢查询日志

慢查询日志记录了所有执行时间超过指定参数（long_query_time，单位：秒，默认10秒）的所有SQL语句的日志。MySQL的慢查询日志默认没有开启，我们可以查看一下系统变量 slow_query_log。

```sql
show variables like 'slow_query_log';
```

如果要开启慢查询日志，需要在MySQL的配置文件（/etc/my.cnf）中配置如下信息：

```sh
# 开启MySQL慢日志查询开关
slow_query_log=1

# 设置慢日志的时间为2秒，SQL语句执行时间超过2秒，就会视为慢查询，记录慢查询日志
long_query_time=2
```

配置完毕之后，重新启动MySQL服务器进行测试，查看慢日志文件中记录的信息`/var/lib/mysql/localhost-slow.log`。

#### 3)**profile**详情

`show profiles` 能够在做SQL优化时帮助我们了解时间都耗费到哪里去了。通过`have_profiling`参数，能够看到当前MySQL是否支持profile操作：

```sql
SELECT @@have_profiling ;
```

YES表示MySQL是支持 profile操作的，但是开关是关闭的。可以通过set语句在session/global级别开启profiling：

```sql
SET profiling = 1;
```

接下来，我们所执行的SQL语句，都会被MySQL记录，并记录执行时间消耗到哪儿去了

```sql
-- 查看每一条SQL的耗时基本情况
show profiles;

-- 查看指定query_id的SQL语句各个阶段的耗时情况
show profile for query query_id;

-- 查看指定query_id的SQL语句CPU的使用情况
show profile cpu for query query_id;
```

#### 4)**explain**

`EXPLAIN` 或者 `DESC`命令获取 MySQL 如何执行 SELECT 语句的信息，包括在 SELECT 语句执行过程中表如何连接和连接的顺序。

```sql
-- 直接在select语句之前加上关键字 explain / desc
EXPLAIN SELECT 字段列表 FROM 表名 WHERE 条件 ;
```

Explain 执行计划中各个字段的含义:

| 字段         |                             含义                             |
| ------------ | :----------------------------------------------------------: |
| id           | select查询的序列号，表示查询中执行select子句或者是操作表的顺序(id相同，执行顺序从上到下；id不同，值越大，越先执行)。 |
| select_type  | 表示 SELECT 的类型，常见的取值有 SIMPLE（简单表，即不使用表连接或者子查询）、PRIMARY（主查询，即外层的查询）、UNION（UNION 中的第二个或者后面的查询语句）、SUBQUERY（SELECT/WHERE之后包含了子查询）等 |
| type         | 表示连接类型，性能由好到差的连接类型为NULL、system、const、eq_ref、ref、range、 index、all 。 |
| possible_key |          显示可能应用在这张表上的索引，一个或多个。          |
| key          |         实际使用的索引，如果为NULL，则没有使用索引。         |
| key_len      | 表示索引中使用的字节数， 该值为索引字段最大可能长度，并非实际使用长度，在不损失精确性的前提下， 长度越短越好 。 |
| rows         | MySQL认为必须要执行查询的行数，在innodb引擎的表中，是一个估计值，可能并不总是准确的。 |
| filtered     | 表示返回结果的行数占需读取行数的百分比， filtered 的值越大越好。 |

### 2、插入数据

#### 1)insert

如果我们需要一次性往数据库表中插入多条记录，可以从以下三个方面进行优化。

- 1、批量插入数据

- 2、手动控制事务

```sql
start transaction;

insert into tb_test values(1,'Tom'),(2,'Cat'),(3,'Jerry');
insert into tb_test values(4,'Tom'),(5,'Cat'),(6,'Jerry');
insert into tb_test values(7,'Tom'),(8,'Cat'),(9,'Jerry');

commit;
```

- 3、优化方案三主键顺序插入，性能要高于乱序插入。

#### 2)大批量插入数据

如果一次性需要插入大批量数据(比如: 几百万的记录)，使用insert语句插入性能较低，此时可以使用MySQL数据库提供的load指令进行插入。

```sql
-- 客户端连接服务端时，加上参数 -–local-infile
mysql –-local-infile -u root -p

-- 设置全局参数local_infile为1，开启从本地加载文件导入数据的开关
set global local_infile = 1;

-- 执行load指令将准备好的数据，加载到表结构中
load data local infile '/root/sql1.log' into table tb_user fields terminated by ',' lines terminated by '\n' ;
```

### 3、主键优化

在InnoDB引擎中，数据行是记录在逻辑结构 page 页中的，而每一个页的大小是固定的，默认16K。那也就意味着， 一个页中所存储的行也是有限的，如果插入的数据行row在该页存储不小，将会存储到下一个页中，页与页之间会通过指针连接。

页可以为空，也可以填充一半，也可以填充100%。每个页包含了2-N行数据(如果一行数据过大，会行溢出)，根据主键排列。

**页分裂:**

- 如果一个页快满了,此时我们插入数据,但下一个页的空间也全部占满.这个时候Mysql将创建一个新页,然后将快满的这个页的部分数据迁移到新页中,这部分数据就是超出原来那个页阈值的那部分数据,之后再插入新的数据,这种现象就是页分裂.

**页合并:**

- 如果页中的数据被删除,那么实际上这块的空间并不会被回收,而是标记为可重复利用.当一个页的数据被删除或者更新,空间小于所规定的阈值大小,那么Mysql会查找前一个页,和后一个页,判断是否可以将这个页合并到另外一个页,这样就可以节省下一个页的空间.

- MERGE_THRESHOLD：合并页的阈值，可以自己设置，在创建表或者创建索引时指定。

::: tip 主键设计原则

- 满足业务需求的情况下，尽量降低主键的长度。

- 插入数据时，尽量选择顺序插入，选择使用AUTO_INCREMENT自增主键。尽量不要使用UUID做主键或者是其他自然主键，如身份证号。

- 业务操作时，避免对主键的修改。

:::

### 4、**order by**优化

MySQL的排序，有两种方式：

- Using filesort : 通过表的索引或全表扫描，读取满足条件的数据行，然后在排序缓冲区sort buffer中完成排序操作，所有不是通过索引直接返回排序结果的排序都叫 FileSort 排序。

- Using index : 通过有序索引顺序扫描直接返回有序数据，这种情况即为 using index，不需要额外排序，操作效率高。

对于以上的两种排序方式，Using index的性能高，而Using filesort的性能低，我们在优化排序操作时，尽量要优化为 Using index。

::: tip order by优化原则:

- 根据排序字段建立合适的索引，多字段排序时，也遵循最左前缀法则。

- 尽量使用覆盖索引。

- 多字段排序, 一个升序一个降序，此时需要注意联合索引在创建时的规则（ASC/DESC）。
    - 创建联合索引(age 升序排序，phone 倒序排序)
    - `create index idx user_age_phone_ad on tb_user(age asc ,phone desc);`

- 如果不可避免的出现filesort，大数据量排序时，可以适当增大排序缓冲区大小sort_buffer_size(默认256k)。

:::

### 5、**group by**优化

分组操作中，我们需要通过以下两点进行优化，以提升性能：

-  在分组操作时，可以通过索引来提高效率。

- 分组操作时，索引的使用也是满足最左前缀法则的。

### 6、**limit**优化

在数据量比较大时，如果进行limit分页查询，在查询时，越往后，分页查询效率越低。

**优化思路**: 一般分页查询时，通过创建 覆盖索引 能够比较好地提高性能，可以通过覆盖索引加子查询形式进行优化。

```sql
explain select * from tb_sku t , (select id from tb limit 2000000,10) a where t.id = a.id;
```

### 7、**count**优化

如果数据量很大，在执行count操作时，是非常耗时的。

- MyISAM 引擎把一个表的总行数存在了磁盘上，因此执行 count(*) 的时候会直接返回这个数，效率很高； 但是如果是带条件的count，MyISAM也慢。

- InnoDB 引擎就麻烦了，它执行 count(*) 的时候，需要把数据一行一行地从引擎里面读出来，然后累积计数。

如果说要大幅度提升InnoDB表的count效率，主要的优化思路：自己计数(可以借助于redis这样的数据库进行,但是如果是带条件的count又比较麻烦了)。

**count用法:**

count() 是一个聚合函数，对于返回的结果集，一行行地判断，如果 count 函数的参数不是NULL，累计值就加 1，否则不加，最后返回累计值。

- count（*）:
    - InnoDB引擎并不会把全部字段取出来，而是专门做了优化，**不取值，服务层直接按行进行累加**。
- count（主键）
    - InnoDB 引擎会遍历整张表，把每一行的 主键id 值都取出来，返回给服务层。服务层拿到主键后，直接按行进行累加(主键不可能为null)
- count（字段）
    - 没有not null 约束 : InnoDB 引擎会遍历整张表把每一行的字段值都取出来，返回给服务层，服务层判断是否为null，不为null，计数累加。有not null 约束：InnoDB 引擎会遍历整张表把每一行的字段值都取出来，返回给服务层，直接按行进行累加。
- count（数字）
    - InnoDB 引擎遍历整张表，但不取值。服务层对于返回的每一行，放一个数字“1”进去，直接按行进行累加。

:::tip

按照效率排序的话，count(字段) < count(主键 id) < count(1) ≈ count(\*)，所以尽量使用 count(\*)。

:::

### 8、**update**优化

```sql
update course set name = 'javaEE' where id = 1 ;
```

当我们在执行删除的SQL语句时，会锁定id为1这一行的数据，然后事务提交之后，行锁释放。

但是当我们在执行如下SQL时。

```sql
update course set name = 'SpringBoot' where name = 'PHP' ;
```

当我们开启多个事务，在执行上述的SQL时，我们发现行锁升级为了表锁。 导致该update语句的性能大大降低。

::: warning

InnoDB的行锁是针对索引加的锁，不是针对记录加的锁 ,并且该索引不能失效，否则会从行锁升级为表锁 。

:::

## 四、视图/存储过程/触发器

### 1、视图

视图（View）是一种虚拟存在的表。视图中的数据并不在数据库中实际存在，行和列数据来自定义视图的查询中使用的表，并且是在使用视图时动态生成的。

通俗的讲，视图只保存了查询的SQL逻辑，不保存查询结果。所以我们在创建视图的时候，主要的工作就落在创建这条SQL查询语句上。

**语法:**

```sql
-- 1、创建
CREATE [OR REPLACE] VIEW 视图名称[(列名列表)] AS SELECT语句 [ WITH [ CASCADED | LOCAL ] CHECK OPTION ]

-- 2、查询
-- 查看创建视图语句：
SHOW CREATE VIEW 视图名称;
-- 查看视图数据：
SELECT * FROM 视图名称 ...... ;

-- 3、修改
-- 方式一
CREATE [OR REPLACE] VIEW 视图名称[(列名列表)] AS SELECT语句 [ WITH [ CASCADED | LOCAL ] CHECK OPTION ]
--方式二
ALTER VIEW 视图名称[(列名列表)] AS SELECT语句 [ WITH [ CASCADED | LOCAL ] CHECK OPTION ]

-- 4、删除
DROP VIEW [IF EXISTS] 视图名称 [,视图名称] ...
```

**检查选项:**

当使用WITH CHECK OPTION子句创建视图时，MySQL会通过视图检查正在更改的每个行，例如 插入，更新，删除，以使其符合视图的定义。 MySQL允许基于另一个视图创建视图，它还会检查依赖视图中的规则以保持一致性。为了确定检查的范围，mysql提供了两个选项： CASCADED 和 LOCAL，默认值为 CASCADED。

- CASCADED 级联。比如，v2视图是基于v1视图的，如果在v2视图创建的时候指定了检查选项为 cascaded，但是v1视图创建时未指定检查选项。 则在执行检查时，不仅会检查v2，还会级联检查v2的关联视图v1。

- LOCAL 本地。比如，v2视图是基于v1视图的，如果在v2视图创建的时候指定了检查选项为 local ，但是v1视图创建时未指定检查选项。 则在执行检查时，知会检查v2，不会检查v2的关联视图v1。

**视图的更新:**

要使视图可更新，视图中的行与基础表中的行之间必须存在一对一的关系。如果视图包含以下任何一项，则该视图不可更新：

- 1、聚合函数或窗口函数（SUM()、 MIN()、 MAX()、 COUNT()等）

- 2、DISTINCT

- 3、GROUP BY

- 4、HAVING

- 5、UNION 或者 UNION ALL

:::tip  视图的作用

- 1、**简单**、视图不仅可以简化用户对数据的理解，也可以简化他们的操作。那些被经常使用的查询可以被定义为视图，从而使得用户不必为以后的操作每次指定全部的条件。

- 2、**安全**、数据库可以授权，但不能授权到数据库特定行和特定的列上。通过视图用户只能查询和修改他们所能见到的数据

- 3、**数据独立**、视图可帮助用户屏蔽真实表结构变化带来的影响。

:::

### 2、存储过程

存储过程是事先经过编译并存储在数据库中的一段 SQL 语句的集合，调用存储过程可以简化应用开发人员的很多工作，减少数据在数据库和应用服务器之间的传输，对于提高数据处理的效率是有好处的。

**存储过程思想上很简单，就是数据库 SQL 语言层面的代码封装与重用。**

#### 1)基本语法

```sql
 -- 1、创建
 CREATE PROCEDURE 存储过程名称 ([ 参数列表 ])
 BEGIN
		-- SQL语句
 END ;
 
 -- 2、调用
 CALL 名称 ([ 参数 ]);
 
 -- 3、查看
 SELECT * FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = 'xxx'; -- 查询指定数据库的存储过程及状态信息
 SHOW CREATE PROCEDURE 存储过程名称 ; -- 查询某个存储过程的定义
 
 -- 4、删除
 DROP PROCEDURE [ IF EXISTS ] 存储过程名称 ；
```

在命令行中，执行创建存储过程的SQL时，需要通过关键字 delimiter 指定SQL语句的结束符。

#### 2)变量

在MySQL中变量分为三种类型: 

- 系统变量: 是MySQL服务器提供，不是用户定义的，属于服务器层面。分为全局变量（GLOBAL）、会话变量（SESSION）。

```sql
-- 1、查看系统变量
SHOW [ SESSION | GLOBAL ] VARIABLES ; -- 查看所有系统变量
SHOW [ SESSION | GLOBAL ] VARIABLES LIKE '......'; -- 可以通过LIKE模糊匹配方式查找变量
SELECT @@[SESSION | GLOBAL] 系统变量名; -- 查看指定变量的值

-- 2、设置系统变量
SET [ SESSION | GLOBAL ] 系统变量名 = 值 ;
SET @@[SESSION | GLOBAL]系统变量名 = 值 ;

```

::: warning

- 如果没有指定SESSION/GLOBAL，默认是SESSION，会话变量。

- mysql服务重新启动之后，所设置的全局参数会失效，要想不失效，可以在 /etc/my.cnf 中配置。
-  全局变量(GLOBAL): 全局变量针对于所有的会话。

- 会话变量(SESSION): 会话变量针对于单个会话，在另外一个会话窗口就不生效了。

:::

- 用户定义变量: 是用户根据需要自己定义的变量，用户变量不用提前声明，在用的时候直接用 "@变量名" 使用就可以。其作用域为当前连接。

```sql
-- 1、赋值,赋值时，可以使用 = ，也可以使用 := 。
-- 方式一
SET @var_name = expr [, @var_name = expr] ... ;
SET @var_name := expr [, @var_name := expr] ... ;
-- 方式二
SELECT @var_name := expr [, @var_name := expr] ... ;
SELECT 字段名 INTO @var_name FROM 表名;

-- 2、使用
SELECT @var_name ;
```

用户定义的变量无需对其进行声明或初始化，只不过获取到的值为NULL。

- 局部变量: 是根据需要定义的在局部生效的变量，访问之前，需要DECLARE声明。可用作存储过程内的局部变量和输入参数，局部变量的范围是在其内声明的BEGIN ... END块。

```sql
-- 1、声明
-- 变量类型就是数据库字段类型：INT、BIGINT、CHAR、VARCHAR、DATE、TIME等。
DECLARE 变量名 变量类型 [DEFAULT ... ] ;

-- 2、赋值
SET 变量名 = 值 ;
SET 变量名 := 值 ;
SELECT 字段名 INTO 变量名 FROM 表名 ... ;
```

#### 3)if语句

```sql
IF 条件1 THEN
	.....
ELSEIF 条件2 THEN -- 可选
	.....
ELSE -- 可选
	.....
END IF;
```

#### 4)参数

参数的类型，主要分为以下三种：IN、OUT、INOUT。 具体的含义如下：

- IN:该类参数作为输入，也就是需要调用时传入值(默认)
- OUT:该类参数作为输出，也就是该参数可以作为返回值
- INUOUT:既可以作为输入参数，也可以作为输出参数

```sql
CREATE PROCEDURE 存储过程名称 ([ IN/OUT/INOUT 参数名 参数类型 ])
BEGIN
	-- SQL语句
END
```

#### 5)case

case结构及作用，和我们在基础篇中所讲解的流程控制函数很类似。有两种语法格式：

语法一:

```sql
-- 含义： 当case_value的值为 when_value1时，执行statement_list1，当值为 when_value2时，执行statement_list2， 否则就执行 statement_list

CASE case_value
	WHEN when_value1 THEN statement_list1
[ WHEN when_value2 THEN statement_list2] ...
[ ELSE statement_list ]
END CASE;
```

语法二:

```sql
-- 含义： 当条件search_condition1成立时，执行statement_list1，当条件search_condition2成立时，执行statement_list2， 否则就执行 statement_list

CASE
WHEN search_condition1 THEN statement_list1
[WHEN search_condition2 THEN statement_list2] ...
[ELSE statement_list]
END CASE;
```

**如果判定条件有多个，多个条件之间，可以使用 and 或 or 进行连接。**

#### 6)while

while 循环是有条件的循环控制语句。满足条件后，再执行循环体中的SQL语句。具体语法为：

```sql
-- 先判定条件，如果条件为true，则执行逻辑，否则，不执行逻辑
WHILE 条件 DO
		SQL逻辑...
END WHILE;
```

#### 7)repeat

repeat是有条件的循环控制语句, 当满足until声明的条件的时候，则退出循环 。具体语法为：

```sql
-- 先执行一次逻辑，然后判定UNTIL条件是否满足，如果满足，则退出。如果不满足，则继续下一次循环
REPEAT
	SQL逻辑...
	UNTIL 条件
END REPEAT;
```

#### 8)loop

LOOP 实现简单的循环，如果不在SQL逻辑中增加退出循环的条件，可以用其来实现简单的死循环。

LOOP可以配合一下两个语句使用：

- LEAVE ：配合循环使用，退出循环。

- ITERATE：必须用在循环中，作用是跳过当前循环剩下的语句，直接进入下一次循环。

```sql
[begin_label:] LOOP
		SQL逻辑...
END LOOP [end_label];

LEAVE label; -- 退出指定标记的循环体
ITERATE label; -- 直接进入下一次循环
```

#### 9)游标

游标（CURSOR）是用来存储查询结果集的数据类型 , 在存储过程和函数中可以使用游标对结果集进行循环的处理。游标的使用包括游标的声明、OPEN、FETCH 和 CLOSE，其语法分别如下。

```sql
-- 游标声明
DECLARE 游标名称 CURSOR FOR 查询语句 ;

-- 打开游标
OPEN 游标名称 ;

-- 获取游标记录
FETCH 游标名称 INTO 变量 [, 变量 ] ;

-- 关闭游标
CLOSE 游标名称 ;
```

#### 10)条件处理程序

条件处理程序（Handler）可以用来定义在流程控制结构执行过程中遇到问题时相应的处理步骤。具体语法为：

```sql
DECLARE handler_action HANDLER FOR condition_value [, condition_value]
... statement ;
```

- `handler_action` 的取值：

    - `CONTINUE`: 继续执行当前程序

    - `EXIT`: 终止执行当前程序

- `condition_value` 的取值：
    - `SQLSTATE`: sqlstate_value: 状态码，如 02000
    - `SQLWARNING`: 所有以01开头的SQLSTATE代码的简写
    - `NOT FOUND`: 所有以02开头的SQLSTATE代码的简写
    - `SQLEXCEPTION`: 所有没有被SQLWARNING 或 NOT FOUND捕获的SQLSTATE代码的简写

### 3、存储函数

存储函数是有返回值的存储过程，存储函数的参数只能是IN类型的。具体语法如下：

```sql
CREATE FUNCTION 存储函数名称 ([ 参数列表 ])
RETURNS type [characteristic ...]
BEGIN
	-- SQL语句
	RETURN ...;
END ;
```

characteristic说明：

- DETERMINISTIC：相同的输入参数总是产生相同的结果
- NO SQL ：不包含 SQL 语句。

- READS SQL DATA：包含读取数据的语句，但不包含写入数据的语句。

### 4、触发器

触发器是与表有关的数据库对象，指在insert/update/delete之前(BEFORE)或之后(AFTER)，触发并执行触发器中定义的SQL语句集合。触发器的这种特性可以协助应用在数据库端确保数据的完整性, 日志记录 , 数据校验等操作 。

使用别名OLD和NEW来引用触发器中发生变化的记录内容，这与其他的数据库是相似的。现在触发器还只支持行级触发，不支持语句级触发。

- INSERT触发器:NEW 表示将要或者已经新增的数据
- UPDATE触发器:OLD 表示修改之前的数据 , NEW 表示将要或已经修改后的数据
- DELETE触发器:OLD 表示将要或者已经删除的数据

创建:

```sql
CREATE TRIGGER trigger_name
BEFORE/AFTER INSERT/UPDATE/DELETE
ON tbl_name FOR EACH ROW -- 行级触发器
BEGIN
	trigger_stmt ;
END;
```

查看:

```sql
SHOW TRIGGERS ;
```

删除:

```sql
DROP TRIGGER [schema_name.]trigger_name ; -- 如果没有指定 schema_name，默认为当前数据库
```

示例:

```sql
create trigger tb_user_insert_trigger
	after insert on tb_user for each row
begin
	insert into user_logs(id, operation, operate_time, operate_id, operate_params)
VALUES
	(null,'insert', now(), new.id, concat('插入的数据内容为:
	id=',new.id,',name=',new.name,', phone=', NEW.phone,', email=', NEW.email,', profession=', NEW.profession));
end;
```

