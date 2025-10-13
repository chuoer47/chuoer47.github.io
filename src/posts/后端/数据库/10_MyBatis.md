---
title: MyBatis
date: 2024-05-22 16:22:02
tag: mysql
category: 数据库
icon: "/img/mybatis.svg"
order: 10
---

<!--more--->

# MyBatis

## 一、介绍

MyBatis 是支持定制化SQL、存储过程以及高级映射的优秀的持久层框架。MyBatis 避免了几乎所有的 JDBC 代码和手动设置参数以及获取结果集。MyBatis 可以对配置和原生Map使用简单的 XML 或注解，将接口和 Java 的 POJOs(Plain Old Java Objects,普通的 Java对象)映射成数据库中的记录。

::: info MyBatis 的框架结构主要包含以下四个部分：

- SQL Mapper：负责定义 SQL 语句，并将 SQL 语句映射成为 Java 对象或 Map 集合的结果。
- MyBatis 核心：提供执行 SQL 语句的底层逻辑，包括管理 SQL 会话、连接池和事务等资源。
- 数据源：为 SQL 执行器提供数据库连接。
- MyBatis 插件：允许用户在运行过程中对 MyBatis 核心进行扩展。

:::

::: info  MyBatis 在开发过程中常用的工具有：

 	1. MyBatis Generator：可以根据数据库表自动生成对应的 Java 实体类和 XML 映射文件。
 	2. MyBatis Plugin：可以通过插件机制扩展 MyBatis 的功能。
 	3. PageHelper：可以很方便地对查询结果进行分页处理。
 	4. MyBatis Plus：是一个开源的 MyBatis 增强工具，提供了很多实用的功能。

:::

## 二、使用

使用 MyBatis 完成一次简单的数据库操作只需要以下几个步骤：

- 定义实体类。
- 编写 Mapper Interface 接口。
- 编写 Mapper XML 文件。
- 配置 MyBatis。
- 获取 SqlSession 对象。
- 调用 Mapper 的方法来执行 SQL 语句。

### 1、相关依赖

```xml
#lombok工具包
<dependency>
    <groupId>org.projectlombok</groupId>
    <artifactId>lombok</artifactId>
    <optional>true</optional>
</dependency>

<dependency>
    <groupId>org.mybatis</groupId>
    <artifactId>mybatis-spring</artifactId>
    <version>${mybatis.version}</version>
</dependency>

<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-jdbc</artifactId>
    <version>${spring.version}</version>
</dependency>

```

### 2、 定义实体类

定义一个 User 实体类，用于存储数据库中用户的信息：

```java
public class User {
    private int id;
    private String name;
    private int age;
    private String gender;
    // 省略 getter 和 setter 方法
}
```

### 3 、编写 Mapper Interface 接口

定义一个 UserMapper 接口，用于定义操作数据库的方法：

```java
public interface UserMapper {
    User getUserById(int id);
}
```

### 4、编写 Mapper XML 文件

定义一个 user.xml 文件，用于配置 SQL 语句和映射关系：

```xml
<mapper namespace="com.example.dao.UserMapper">
    <select id="getUserById" parameterType="int" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
</mapper>
```

其中，id 属性指定了对应的方法名称，parameterType 属性指定了传入参数的类型，resultType 属性指定了返回结果的类型。



## 三、动态SQL

```xml
<!--动态SQL-->
	<!--  <set>  <if>  -->
    <update id="update">
        update emp
        <set>
            <if test="username != null">username=#{username},</if>
            <if test="name != null"> name =#{name},</if>
            <if test="gender != null">gender=#{gender},</if>
            <if test="image != null">image=#{image},</if>
            <if test="job != null">job=#{job},</if>
            <if test="entryDate != null">entrydate=#{entryDate},</if>
            <if test="deptId != null">dept_id= #{deptId},</if>
            <if test="updateTime != null">update_time=now(),</if>
        </set>
        where id=#{id}
    </update>

	<!--  <where>  <if>  -->
    <select id="list" resultType="com.ruyiwei.pojo.Emp">

        <include refid="commonSelect"/>
        <where>
            <if test="name != null">
                and name like concat('%',#{name},'%')
            </if>
            <if test="gender != null">
                and gender = #{gender}
            </if>
            <if test="begin != null and end != null">
                and entrydate between #{begin} and #{end}
            </if>
        </where>
        order by update_time desc
    </select>

	<!--  <foreach>  -->
 	<delete id="deleteByIds">
        delete from emp where id in
                        <foreach collection="ids" item="id" separator="," open="(" close=")">
                            #{id}
                        </foreach>
    </delete>
```

## 四、分页查询

**pageHelper**

```xml
 <dependency>
            <groupId>com.github.pagehelper</groupId>
            <artifactId>pagehelper-spring-boot-starter</artifactId>
            <version>1.4.6</version>
        </dependency>
```

**service:**

```java
 public PageBean list(String name, Short gender, LocalDate begin, LocalDate end, Integer page, Integer pageSize) {
       	//1、设置分页参数
     	PageHelper.startPage(page, pageSize);
		//2、查询
        List<Emp> empList = empMapper.list(name, gender, begin, end);
		//3、获取分页
        Page<Emp> p = (Page<Emp>)empList;

        PageBean pageBean =  new PageBean(p.getTotal(), p.getResult());
        return pageBean;
    }
```



# 参考

[1] [https://blog.csdn.net/u012581020/article/details/130635028](https://blog.csdn.net/u012581020/article/details/130635028)