---
title: "XJTUSE-计网-第2章-homework"
date: 2024-05-11 :37
tags:
- 计算机网络
category: 本科课程笔记
order: 109
---

# XJTUSE-计网-第2章-homework

本篇仅为个人复习使用，切勿作业抄袭

1.Explain precisely following abbreviations:

URL, HTML, RTT,MIME,TFTP, NFS,SNMP,JPEG,MPEG

URL:统一资源定位符

HTML：超文本标记语言

RTT：往返时间

MIME：多用途互联网邮件拓展协议

TFTP：简单文件传输协议

NFS：网络文件系统

SNMP：简单网络管理协议

JPEG：联合图像专家组

MPEG：动态图像专家组

2.Specify following system Organization:

Email system

DNS system

a. Email system

电子邮件系统包括如下部分：

1.用户代理

2.邮件服务器：发送邮件服务器，接受邮件服务器

3.邮件协议：SMTP

b.DNS system

域名系统包括如下部分：

1.根域名服务器

2.顶级域名服务器

3.权威域名服务器

4.递归解析器

5.缓存

6.DNS协议

7.DNS记录; RR格式:(name ， value ， type ， ttl)

type = MX,A,CNAME,NS

3.True or false?

(1) A user requests a Web page that consists of some text and three images. For this page, the client will send one request message and receive four response messages.

错误，至少包含一个请求和多个响应，具体的响应消息个数要根据具体情况判定！

(2) Two distinct Web pages (for example,www.mit.edu/research .html and www.mit.edu/students.html) can be sent over the same persistent connection.

正确，因为主机名一致，www.mit.edu/

(3) With nonpersistent connections between browser and origin server, it is possible for a single TCP segment to carry two distinct HTTP request messages.

错误，一个TCP只能携带一个HTTP请求。

(4) The Date: header in the HTTP response message indicates when the object in the response was last modified.

错误，Date反应的是响应消息生成的时间。

(5) HTTP response messages never have an empty message body

错误，比如Header请求的响应消息就是空消息主体。

4.Assume that the RTT between a client and the local DNS server is TTl, while the RTT between the local DNS server and other DNS servers is RTTr . Assume that no DNS server performs caching.

(1) What is the total response time for the scenario illustrated in Figure 2.19? In practice, the queries typically follow the pattern in Figure 2.19: The query from the requesting host to the local DNS server is recursive, and the remaining queries are iterative. in Figure 2.19, each time the local DNS server dns.nyu.edu receives a reply from some DNS server, it can cache any of the information contained in the reply.

![](https://i-blog.csdnimg.cn/blog_migrate/537e8426fb246bc5aeb55718e786c55a.png)

(2) What is the total response time for the scenario illustrated in Figure 2.20? Figure 2.20 shows a DNS query chain for which all of the queries are recursive.

![](https://i-blog.csdnimg.cn/blog_migrate/a584c54b4d431363a386812425be2f5e.png)

(3) Assume now that the DNS record for the requested name is cached at the local DNS server. What is the total response time for the two scenarios?

解答

(1)第一种为递归式查询，查询时间为 2 * TTL + 3*RTTr

其中1个TTL建立TCP连接，1个TTL进行查询。3个RTTr为递归查询的花费时间

(2)第二种为迭代式查询，查询时间为 2 * TTL + 3*RTTr

其中1个TTL建立TCP连接，1个TTL进行查询。3个RTTr为迭代查询的花费时间

(3)第三种花费时间为 2 * TTL

其中1个TTL建立TCP连接，1个TTL进行查询。由于本地DNS服务器缓存中存在查询结果，因此无需再向其他服务器进行查询。
