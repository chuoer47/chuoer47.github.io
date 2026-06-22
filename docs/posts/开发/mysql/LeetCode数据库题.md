---
title: LeetCode数据库题
date: 2025-08-26
tags: [MySQL, LeetCode]
category: MySQL
order: 9
---

# Leetcode数据库题目

刷Leetcode中数据库(MySQL)题目，整理写题过程中遇到的语法糖&Tips&踩坑经验。**基础语法略过。**

## 语法糖

### 日期函数

在题目中经常需要在`where`语句中处理与日期相关的条件。更多信息查看[官方技术文档](https://dev.mysql.com/doc/)

- 日期格式化`DATE_FORMAT(date, format)`。

其中，%Y（4 位年份）、%m（月份，补零）、%d（日期，补零）、%H（24 小时制）、%i（分钟）、%s（秒）。

- 提取日期部分
`YEAR(date) / MONTH(date) / DAY(date)`

使用场景：判断某产品在2025年2月一个月内的销售情况。
```sql
WHERE YEAR(sell_date) = 2025 and MONTH(sell_date) = 2
```

- 日期计算

增加：`DATE_ADD(date, INTERVAL expr unit)`

删除：`DATE_SUB(date, INTERVAL expr unit)`

计算天数：`DATEDIFF(date1, date2)`

### 条件选择
题目需要条件查询，可根据情况使用

- IF：`IF(condition, value_if_true, value_if_false)`
- CASE

CASE语句有两种常见的写法：
```sql
CASE expression
    WHEN value1 THEN result1
    WHEN value2 THEN result2
    ...
    ELSE default_result
END
```
第一种常用于ENUM类型
```sql
CASE
    WHEN condition1 THEN result1
    WHEN condition2 THEN result2
    ...
    ELSE default_result
END
```
第二种使用范围广

### 小数四舍五入

`ROUND(number, decimal_places)`

### GROUP_CONCAT()
题目：[1484. 按日期分组销售产品](https://leetcode.cn/problems/group-sold-products-by-the-date/)

在 MySQL 中，GROUP_CONCAT() 是一个聚合函数，用于将分组后的多个行数据按照指定格式拼接成一个字符串，常用于将同一分组中的多个值合并展示。

```sql
GROUP_CONCAT([DISTINCT] 要拼接的字段 [ORDER BY 排序字段 ASC/DESC] [SEPARATOR '分隔符'])
```

### regexp_like

regexp_like是MySQL的正则表达式

题目: [1517. 查找拥有有效邮箱的用户](https://leetcode.cn/problems/find-users-with-valid-e-mails/description/)

题目答案：

```sql
select *
from users
where regexp_like(mail,'^[a-zA-Z][a-zA-Z0-9._-]*@leetcode\\.com$','c')
```

注意的点：
- ^ 和 $：分别表示字符串的开始和结束，确保整个 mail 字段严格匹配模- 式，而非包含匹配子串。
- [a-zA-Z]：字符集简写，匹配任意大小写字母（等价于 [A-Za-z]），第一个字符限制为字母。
- \\.：由于 . 在正则中是特殊字符（匹配任意字符），这里用 \\ 转义为普通点号（MySQL 中需双重转义，其他数据库可能只需单转义 \.）。
- 第三个参数 'c'：表示 "区分大小写"（case-sensitive），是正则匹配模式的简化标识，无需在正则本身中添加修饰符，属于函数特有的语法糖。

### 共用表达式（CTE）

WITH AS 语句用于创建公用表表达式（CTE，Common Table Expression），可以将一个查询结果临时命名为一个表，供后续查询引用。它的主要作用是简化复杂查询，提高代码可读性和可维护性。

语法：
```sql
WITH 临时表名1 AS (
  SELECT ...  -- 子查询1
),
临时表名2 AS (
  SELECT ...  -- 子查询2，可引用临时表名1
)
-- 主查询，可引用上面定义的所有临时表
SELECT ... FROM 临时表名1 JOIN 临时表名2 ...;
```

### 窗口函数

基本语法
```sql
函数名() OVER (
  PARTITION BY 分组字段  -- 可选，按指定字段分组后再排名
  ORDER BY 排序字段 [ASC/DESC]  -- 必须，指定排序规则
)
```
`PARTITION BY`：将数据按指定字段分成多个组，每组内独立排名（不指定则对整个结果集排名）。

`ORDER BY`：指定排序依据（升序 / 降序），决定排名顺序。

#### 窗口函数之排名

在 MySQL 中，排名类窗口函数用于对一组数据进行排序并生成排名序号，常用的有 `RANK()`、`DENSE_RANK()` 和 `ROW_NUMBER()`。它们的核心区别在于处理 "并列排名" 的方式不同。

1. `RANK()`：并列数据占用相同排名，后续排名会 "跳号"。
2. `DENSE_RANK()`：并列数据占用相同排名，后续排名 "不跳号"（连续排名）。
3. `ROW_NUMBER()`：不考虑并列，按顺序依次生成唯一序号（即使数据相同，排名也不同）。

#### 窗口函数之SUM
在 SQL 中，SUM()作为窗口函数使用时，能够对一组行（窗口）中的数值值进行求和计算，并且可以保留每一行的详细信息，而不像普通聚合函数那样会将多行数据合并为一行结果。
```sql
SUM(列名) OVER (
    [PARTITION BY 分区列]
    [ORDER BY 排序列 [ASC|DESC]]
    [ROWS|RANGE 窗口框架]
)
```
具体用处：
1. 实现前缀和功能
2. 一组行（窗口）中的数值值进行求和计算

#### 窗口函数之FIRST_VALUE

在 SQL 中，FIRST_VALUE()是一个窗口函数，用于返回窗口框架内的第一行数据的指定列值。它可以结合分区、排序和窗口框架定义，灵活地获取不同范围内的首行数据，且不会像聚合函数那样合并 rows，而是为每一行返回对应的首行参考值。


## Tips

### GROUP BY 多字段
```sql
SELECT 字段1, 字段2, 聚合函数(字段)
FROM 表名
GROUP BY 字段1, 字段2 [, 更多字段];
```
可与窗口函数结合使用完成多种常见场景使用。

### 经典处理连续出现的数字问题

题目：[180. 连续出现的数字](https://leetcode.cn/problems/consecutive-numbers/description/)

```sql
with
    aux_list as (
        select num,id-cast(row_number() over(partition by num order by id) as signed) aux
        from Logs
    ),
    cnt_list as(
        select num,count(*) cnt
        from aux_list
        group by num,aux
    )
select distinct num as ConsecutiveNums
from cnt_list
group by num
having max(cnt) >= 3
```

### IFNULL
MySQL独有的函数。

表达式`IFNULL(expr1, expr2)`，如果 expr1 不是 NULL，返回 expr1；如果 expr1 是 NULL，返回 expr2


## 踩坑

### in中嵌套的子SQL语句无法使用limit
问题描述：MySQL 对 IN 子句中嵌套的子查询使用 LIMIT 存在限制，直接使用可能会报错。这是因为数据库引擎在解析 IN 子句时，对内部子查询的语法支持有特殊要求。

案例：限定前10个用户。

错误代码：
```sql
SELECT * FROM orders
WHERE user_id IN (
  SELECT user_id FROM users
  ORDER BY active_score DESC
  LIMIT 10  -- 此处 LIMIT 可能导致错误
);
```
解决办法：
1. 通过将带 LIMIT 的子查询包装成一个派生表（Derived Table），可以绕过这个限制。
```sql
SELECT * FROM orders
WHERE user_id IN (
  SELECT user_id FROM (
    -- 内层子查询带 LIMIT
    SELECT user_id FROM users
    ORDER BY active_score DESC
    LIMIT 10
  ) AS sub_query  -- 必须为派生表指定别名
);
```
2.JOIN 替代 IN（优先使用）
```sql
SELECT o.* FROM orders o
JOIN (
  SELECT user_id FROM users
  ORDER BY active_score DESC
  LIMIT 10
) AS top_users
ON o.user_id = top_users.user_id;
```

### 无查询结果默认返回NULL问题
踩坑题目: [619. 只出现一次的最大数字](https://leetcode.cn/problems/biggest-single-number/description/)

问题描述：
在 SQL 中，当查询没有匹配结果时，默认不会返回任何行。如果希望在这种情况下显式返回 NULL（或其他默认值）

解决办法：

1. 使用子查询 + LEFT JOIN

将原查询作为子查询，与一个 "虚拟表"（含一行数据）进行左连接，确保至少返回一行结果。
```sql
-- 若原查询无结果，返回 NULL
SELECT t.result
FROM (SELECT 1) AS dummy  -- 虚拟表，确保有一行
LEFT JOIN (
  -- 你的原查询（例如：查询 ID=100 的用户姓名）
  SELECT name AS result FROM users WHERE id = 100
) AS t ON 1=1;  -- 恒真条件，确保左连接生效
```

2.使用聚合函数（**优先使用**）

聚合函数（如 MAX()、MIN()、SUM()）在无匹配行时会返回 NULL，而非空集。

```sql
SELECT MAX(name) AS result  -- 用 MAX() 包裹查询字段
FROM users
WHERE id = 100;
```

### UNION与UNION ALL的区别

踩坑题目：[1965. 丢失信息的雇员](https://leetcode.cn/problems/employees-with-missing-information/)

问题描述：
- UNION：会对合并后的结果集自动去除重复行，只保留唯一记录。即，合并后会执行类似 DISTINCT 的去重操作。
- UNION ALL：保留所有结果行，包括重复数据（即直接拼接多个结果集，不做去重处理）。

### IN 与 NULL的坑
A not in B的原理是拿A表值与B表值做是否不等的比较, 也就是a != b. 在sql中, null是缺失未知值而不是空值(详情请见[MySQL reference](https://dev.mysql.com/doc/refman/8.0/en/working-with-null.html)).

当你判断任意值a != null时, 官方说, "You cannot use arithmetic comparison operators such as =, <, or <> to test for NULL", 任何与null值的对比都将返回null。这点可以用代码 select if(1 = null, 'true', 'false')证实。

**从上述原理可见, 当询问 id not in (select * from XXX)时, 如果XXX中存在null值, 返回结果全为false**。
