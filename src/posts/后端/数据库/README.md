---
title: SQL语句
date: 2024-05-22 16:14:58
tags: mysql
category: 数据库
icon: "/img/SQL.svg"
order: 1
---

<!--more--->

# SQL语句

## 1、数据库操作

```sql
# 查询所有数据库
show databases;

# 创建数据库
create database db02;

# 删除数据库
drop database db02;
```

## 2、表操作

```sql
# DDL：表结构

# 创建
create table tb_user
(
    id int primary key auto_increment comment 'ID，唯一标识',
    username varchar(20) not null unique comment '用户名',
    name varchar(10) not null comment '姓名',
    age int comment '年龄',
    gender char(1) default '男' comment '性别'

) comment '用户表';

# 查看当前数据库下的表
show tables;

# 查看指定表结构
desc tb_user;

# 查看数据库建表语句
show create table tb_emp;



# 修改表结构
# 添加字段
alter table tb_user add qq varchar(11) comment 'QQ';

# 修改字段类型
alter table tb_user modify qq varchar(13) comment 'QQ';

# 修改字段名
alter table tb_user change qq qq_num varchar(13) comment 'QQ';

#删除字段
alter table tb_user drop column qq_num;

# 修改表名
rename table tb_user to user;
```

## 3、数据操作

```sql
#DML 数据操作

/*
    1、插入语句 insert
*/

#     为 tb_emp 表的username name gender插入数据
insert into tb_emp(username, name, gender, create_time, update_time) values ('wuji', '张无忌', 1, now(), now());

#     为 tb_emp 表的所有字段插入值
insert into tb_emp(id, username, password, name, gender, image, job, entrydate, create_time, update_time)
                VALUES(null, 'weiruyi','123', '魏儒艺', 1, '1.jpg', 1, '2024-05-09', now(), now());

insert into tb_emp
                VALUES(null, 'weiruyi2','123', '魏儒艺', 1, '1.jpg', 1, '2024-05-09', now(), now());

#     批量为tb_user表的username, name, gender添加数据
insert into tb_emp(username, name, gender, create_time, update_time) values
                                                                            ('yuqi', '雨琦', 2, now(), now()),
                                                                            ('77qi', '七七', 2, now(), now());




/*
    2、更新数据 update
*/

#     将 tb_emp 表的ID为1 的员工姓名更改为‘张三’
update tb_emp set name = '张三', update_time = now() where id = 1;

#     将所有员工入职日期更改为2010-01-01
update tb_emp set entrydate = '2010-01-01', update_time = now();



/*
    3、删除操作 delete
*/
#     删除tb_emp中id=1的员工
delete from tb_emp where id = 1;

#     删除所有数据
delete from tb_emp;
```



## 4、单表查询

    select
        字段列表
    from
        表名列表         基本查询
    where
        条件列表        条件查询
    group by
        分组字段列表
    having
        分组后条件列表     分组查询
    order by
        排序字段列表      排序查询
    limit
        分页参数        分页查询
```sql
/*
    数据查询语句
    ----------单表查询
*/

# ------------------------------------1、基础查询------------------------------------------
# 1、基础查询

# 查询多个字段
select username, password, name from tb_emp where id < 5;

# 查询所有字段
select * from tb_emp; # 不推荐   不直观，性能低
select id, username, password, name, gender, image, job, entrydate, create_time, update_time from tb_emp; # 推荐

# 设置别名
select username 姓名, password as '密 码' from tb_emp where id < 5;

#查询已有员工关联了哪几种职位
# distinct 去重
select distinct  job from tb_emp;




# -------------------------------------2、条件查询---------------------------------------------
# 2、条件查询

select * from tb_emp where name = '张无忌';
select * from tb_emp where id < 5;
select * from tb_emp where job is null ;

select * from tb_emp where password != '123456';
select * from tb_emp where password <> '123456';

select * from tb_emp where entrydate >= '2000-01-01' and entrydate <= '2010-01-01';
select * from tb_emp where entrydate between '2000-01-01' and '2010-01-01';

select * from tb_emp where entrydate between '2000-01-01' and '2010-01-01' && gender = 2;

select * from tb_emp where job = 2 || job = 4;
select  * from tb_emp where job in (2, 4);

# _单个任意字符  %任意多个字符
select * from tb_emp where name like '__';
select * from tb_emp where name like '张%';




# -------------------------------3、分组查询-------------------------------------
# 3、分组查询

#========== A、聚合函数 (不对null进行运算)==========

# a、count
# count(字段)
select count(id) from tb_emp;
# count(常量）
select count(0) from tb_emp;
# count(*)   推荐，底层进行过优化
select count(*) from tb_emp;

# b、min
select min(entrydate) from tb_emp;

# c、max
select max(entrydate) from tb_emp;

# d、avg
select avg(id) from tb_emp;

# e、sum
select sum(id) from tb_emp;

# ===========B、分组查询===========
# 返回值  1、分组字段  2、聚合函数
select gender,count(*) from tb_emp group by gender;

# having 分组后的过滤条件，可以对聚合函数进行判断
# where 分组前过滤，不能对聚合函数进行判断
select job, count(*) from tb_emp where entrydate <= '2015-01-01' group by job having count(*) >= 2;



# --------------------------------4、排序查询------------------------------------
# 4、排序查询
select * from tb_emp order by entrydate DESC ;
select * from tb_emp order by entrydate ASC , update_time DESC ;


# -------------------------------5、分页查询-------------------------------------
# 5、分页查询
# limit 起始索引,查询记录数

# 1)从起始索引0开始，每页展示5条
select * from tb_emp limit 0, 5;
# 2)查询第一页员工数据，每页展示5条
select * from tb_emp limit 0, 5;
# 3)查询第二页员工数据，每页展示5条
select * from tb_emp limit 5, 5;

# 起始索引 = （页码 - 1）* 每页展示记录数
```

## 5、多表查询

**连接查询**
    `内连接`：相当于查询A,B交集的部分数据
    `外连接`：
        左外连接：查询左表的所有数据（包括两张表的交集部分）
        右外连接：查询右表的所有数据（包括两张表的交集部分）

```sql
/*
    多表查询
*/
select *
from tb_emp,
     tb_dept
where tb_emp.dept_id = tb_dept.id;

/*
  连接查询
    内连接：相当于查询A,B交集的部分数据
    外连接：
        左外连接：查询左表的所有数据（包括两张表的交集部分）
        右外连接：查询右表的所有数据（包括两张表的交集部分）
*/

# 隐式内连接
select tb_emp.name, tb_dept.name
from tb_emp,
     tb_dept
where tb_emp.dept_id = tb_dept.id;
# 显示内连接
select tb_emp.name, tb_dept.name
from tb_emp
         inner join tb_dept on tb_emp.dept_id = tb_dept.id;
select emp.name name, dept.name dept
from tb_emp emp
         inner join tb_dept dept on emp.dept_id = dept.id;
#起别名

#左外连接
select tb_emp.name, tb_dept.name
from tb_emp
         left outer join tb_dept on tb_emp.dept_id = tb_dept.id;
# 右外连接
select tb_dept.name, tb_emp.name
from tb_emp
         right join tb_dept on tb_emp.dept_id = tb_dept.id;



/*
    子查询
*/
# 1)标量子查询-----子查询结果是单个值------------------------------------------------------
# 查询教研部员工信息
select id
from tb_dept
where name = '教研部';
select *
from tb_emp
where dept_id = 2;

select *
from tb_emp
where dept_id = (select id from tb_dept where name = '教研部');

# 查询“方东白”入职之后得员工信息
select *
from tb_emp
where entrydate >
      (select entrydate from tb_emp where name = '方东白');



# 2)列子查询-----子查询结果是一列------------------------------------------------------
# 查询教研部以及咨询部的员工信息
select *
from tb_emp
where dept_id in
      (select id from tb_dept where name in ('教研部', '咨询部'));


# 3)行子查询-----子查询结果是一行------------------------------------------------------
# 查询与韦一笑入职日期和职位都相同的员工信息
# 拆分
select entrydate, job
from tb_emp
where name = '韦一笑';
select *
from tb_emp
where entrydate = '2007-01-01'
  and job = '2';
# 合并
select *
from tb_emp
where entrydate = (select entrydate from tb_emp where name = '韦一笑')
  and job = (select job from tb_emp where name = '韦一笑');
# 优化
select *
from tb_emp
where (entrydate, job) = (select entrydate, job from tb_emp where name = '韦一笑');


# 3)表子查询------------------------------子查询结果是多行多列-----------------------------
# 查询入职日期是‘2006-01-01’之后得员工信息以及其部门信息

select *
from tb_emp
where entrydate > '2006-01-01';

select e.*, d.name
from (select * from tb_emp where entrydate > '2006-01-01') e,
     tb_dept d
where e.dept_id = d.id;

```

## 6、事务

一组操作的集合。它是一个不可分割的工作单位，事务会把所有操作作为一个整体一起向系统提交，即这些操作要么同时成功要么同时失败

**事务控制：**
    开启事务： `start transaction;  / begin`
    提交事务：`commit`
    回滚事务：`rollback`

**事务的四大特性：(ACID)**
    A-原子性：事务是不可分割的最小单元，要么全部成功，要么全部失败
    C-一致性：事务完成时，必须使所有数据都保持一致性
    I-隔离性：数据库系统提供的隔离机制，保证事务在不受外部并发操作影响的独立环境下运行
    D-持久性：事务一旦提交或者回滚，他对数据库中的数据的改变就是永久的

```sql
/*解散部门*/
# 开启事务
start transaction ;

# 删除部门
delete from tb_dept where id = 3;
# 删除部门下的员工
delete from tb_emp where dept_id = 3;

# 提交事务
commit;
# 回滚事务
rollback ;
```

## 7、索引

  索引（index）帮助数据库高效获取数据的数据结构<br>
        &emsp;没有索引查找：全表扫描<br>
        &emsp;有索引查找：B+Tree索引，Hash索引，Full-Text索引<br>
    &nbsp;`优点`：提高查询效率，降低IO成本；通过索引对数据排序降低排序成本，降低cpu消耗<br>
   &nbsp; `缺点`：会降低增删改的效率；占用空间<br>

:::tip

`注意：`
 主键字段建表时会自动创建索引
 添加唯一约束实际上会添加唯一索引

:::





```sql
# 创建索引
create index idx_emp_name on tb_emp(name);

# 查询索引
show index from tb_emp;

# 删除索引
drop index idx_emp_name on tb_emp;
```

