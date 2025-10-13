---
title: Redis基础
date: 2024-05-27 16:14:58
tags: redis
category: 数据库
order: 20
icon: "/img/redis.svg"
---

<!--more--->

# Redis

## 一、Redis基础

**Redis五大数据类型**：String(字符串)、Hash(哈希)、List(列表)、Set(集合) 和 zset(sorted set:有序集合)

### 1、字符串操作指令

:::tip

- String是redis最基本的操作，一个key对应一个value str1 := "hello" 

- String类型是二进制安全的。除普通的字符串外，也可以存放图片等数据 
- redis中字符串value最大是512M

:::

```
SET key value    	设置指定key的值
GET key				获取指定key的值
SETEX key seconds value		设置指定key的值，并将key的过期时间设为seconds秒
SETNX key value				只有在key不存在时设置key 的值
```



### 2、哈希操作命令

```
HSET key field value  			将哈希表key 中的字段field 的值设为value
HGET key field					获取存储在哈希表中指定字段的值
HDEL key field					删除存储在哈希表中的指定字段
HKEYS key						获取哈希表中所有字段
HVALS key						获取哈希表中所有值
```

使用`hmset`和`hmget`可以一次性设置多个 field的值和返回多个field的值

### 3、列表操作命令

```
LPUSH key value1 [value2]		将一个或多个值插入到列表头部
LRANGE key start stop			获取列表指定范围内的元素
RPOP key						移除并获取列表最后一个元素
LLEN key						获取列表长度
//L和R代表左右
```

 List 数据，可以从左或者右插入添加 如果值全移除，对应的键也就消失了

### 4、集合操作命令

```
SADD key member1 [member2]		向集合添加一个或多个成员心
SMEMBERS key					返回集合中的所有成员
SCARD key						获取集合的成员数
SINTER key1 [key2]				返回给定所有集合的交集
SUNION key1[key2]				返回所有给定集合的并集
SREM key member1 [member2]		删除集合中一个或多个成员
```



### 5、有序集合操作命令

Redis有序集合是string类型元素的集合，且不允许有重复成员。每个元素都会关联一个double类型的分数。

```
ZADD key score1 member1 [score2 member2]	向有序集合添加一个或多个成员
ZRANGE key start stop [WITHSCORES]			通过索引区间返回有序集合中指定区间内的成员
ZINCRBY key increment member				有序集合中对指定成员的分数加上增量increment
ZREM key member [member ...]				移除有序集合中的一个或多个成员
```



### 6、通用命令

```
KEYS pattern		查找所有符合给定模式(pattern)的 key
EXISTS key			检查给定key是否存在
TYPE key			返回key所储存的值的类型
DEL key				该命令用于在key存在是删除 key
```



## 二、Java操作Redis（Spring Data Redis）

:::info  Redis的Java客户端：

- Jeids

- Lettuce

- Spring Data Redis

:::

`Spring Data Redis`是 Spring的一部分，对 Redis底层开发包进行了高度封装。在Spring项目中，可以使用spring Data Redis来简化操作。

### 1、maven坐标

```xml
		<dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>
```

### 2、配置Redis数据源

```yaml
spring:
  redis:
    host: localhost
    port: 6379
    password: 123456
    database: 0
```

### 3、编写配置类，创建RedisTemplate对象

```java
@Slf4j
@Configuration
public class RedisConfiguration {

    @Bean
    public RedisTemplate redisTemplate(RedisConnectionFactory redisConnectionFactory) {
        log.info("开始创建redisTemplate");

        RedisTemplate redisTemplate = new RedisTemplate();
        //设置Redis连接工厂对象
        redisTemplate.setConnectionFactory(redisConnectionFactory);
        //设置redis key的序列化器
        redisTemplate.setKeySerializer(new StringRedisSerializer());
        return redisTemplate;
    }
}
```

### 4、使用redisTemplate对象

**String:**

```java
 	@Test
    public void testString(){
        ValueOperations valueOperations = redisTemplate.opsForValue();
        //set
        valueOperations.set("city","Changsha");

        //get
        String city = (String) valueOperations.get("city");
        System.out.println(city);

        //setex
        valueOperations.set("code","1234", 3, TimeUnit.MINUTES);

        //setnx
        valueOperations.setIfAbsent("name","ruyi");
        valueOperations.setIfAbsent("name","ruyi_wei");
    }
```

**Hash:**

```java
   @Test
    public void testHash(){
        HashOperations hashOperations = redisTemplate.opsForHash();

        //hset
        hashOperations.put("100", "name", "Tom");
        hashOperations.put("100", "age", "10");
        hashOperations.put("100", "age2", "10");

        //hget
        String name = (String) hashOperations.get("100", "name");
        System.out.println(name);

        //hkeys
        Set keys = hashOperations.keys("100");
        System.out.println(keys);

        //hvals
        List values = hashOperations.values("100");
        System.out.println(values);

        //hdel
        hashOperations.delete("100", "age2");
        
    }
```

**......其余类型以此类推**

## 三、GoLang连接redis

### 1、安装第三方开源redis库

1. 使用第三方开源的redis库：github.com/grayburd/redigo/redis 
2. 在使用redis前，先安装第三方redis库，在GOPATH路径下执行安装指令

```shell
go get github.com/grayburd/redigo/redis
```

### 2、Set/Get 接口

通过Golang添加和获取key-value

```go
package main

import (
	"fmt"
	"github.com/garyburd/redigo/redis"
)
func main() {
	//连接到redis
	c, err := redis.Dial("tcp", "localhost:6379")
    if err != nil {
    	fmt.Println("conn redis failed,err=", err)
    	return
    }
    defer c.Close()
    //向redis写入数据
    _, err = c.Do("Set", "key1", 998)
    if err != nil {
    	fmt.Println(err)
    	return
    }
    //从redis中读取数据
    // r, err := c.Do("Get", "key1")
    //因为返回的 r是 interface{}
    //key1对应的是int,所以需要转换
    r, err := redis.Int(c.Do("Get", "key1"))
    if err != nil {
    	fmt.Println("get key1 failed, err=", err)
    	return
    }
    fmt.Println(r)
}

```

批量Set/Get数据：

```go
_, err := c.Do("MSet", "name", "harden", "age", "77")
```

```go
r, err := redis.Strings(c.Do("MGet", "name", "age"))
//strings
```

设置有效时间

```go
_, err := c.Do("expire", "name", 10)
```

### 3、redis连接池

:::info redis链接池，流程如下

1.  事先初始化一定数量的链接，放入到链接池 
2. 当go需要操作redis时，直接从redis连接池取出链接即可 
3. 这样可以节省临时获取redis链接的时间，从而提高效率

:::

```go
var pool *redis.Pool
pool = &redis.Pool{
	MaxIdle : 8, //最大空闲链接数
	MaxActive : 0, //表示和数据库的最大链接数，0表示没有限制
	IdleTimeout : 100, //最大空闲时间
	Dial : func() (redis.Conn, error){ //初始化链接的代码
		return redis.Dial("tcp", "localhost:6379")
	},
}

c := pool.Get() //从连接池中取出一个连接
pool.Close() //关闭连接池，一旦关闭就不能从连接池再取出连接了
```

示例：

```go
package main

import (
	"fmt"
	"github.com/garyburd/redigo/redis"
)

//定义一个全局的pool
var pool *redis.Pool

//当启动程序时，就初始化连接池
func init() {
	pool = &redis.Pool{
	MaxIdle : 8, //最大空闲链接数
	MaxActive : 0, //表示和数据库的最大链接数，0表示没有限制
	IdleTimeout : 100, //最大空闲时间
	Dial : func() (redis.Conn, error){ //初始化链接的代码
			return redis.Dial("tcp", "localhost:6379")
		},
	}
}

func main() {
	//先从pool 取出一个链接
	conn := pool.Get()
	defer conn.Close()
    
	_, err := conn.Do("Set", "name", "tom~")
	if err != nil {
		fmt.Println("conn.Do err=", err)
		return
		}
    
	//取出
	r, err := redis.String(conn.Do("Get", "name"))
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Println("r=",r)
}
```

