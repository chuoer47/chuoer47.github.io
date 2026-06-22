---
title: "XJTUSE-计网-第4次-homework"
date: 2024-06-20 :06
tags:
- 计算机网络
category: 本科课程笔记
order: 111
---

# XJTUSE-计网-第4次-homework

本博客仅自用，切勿作业抄袭

1.Explain precisely following abbreviations:

AS, RIP, OSPF, IGRP,ICMP,BGP,ARP,RARP,CIDR ,DHCP, MTU

AS：自治系统

RIP：路由信息协议

OSPF：开放最短路径优先

IGRP：内部网关路由协议

ICMP：互联网控制消息协议

BGP：边界网关协议

ARP：地址解析协议

RARP：反向地址解析协议

CIDR：无类别域间路由

DHCP：动态主机配置协议

MTU：最大传输单元

2.Can ATM network provide QoS support? Why?

ATM 网络可以提供 QoS(服务质量)支持。这是因为 ATM 网络采用了一种基于虚电路的通信模 式，可以对数据流进行划分和分类，并为每个数据流分配带宽和优先级，以保证不同类型的数据流能够 在网络中得到合适的服务质量。ATM 网络还提供了流量控制和拥塞控制机制，以防止网络出现过载和 拥塞情况，从而提高网络的可靠性和稳定性。

3.Which protocols does ip layer include?

	Internet Protocol(IP)：IP是IP层的基本协议。它提供了数据包在网络之间进行传输所需的寻址和路由功能。

	Internet Control Message Protocol(ICMP)：ICMP是在IP层操作的支持协议。它负责在网络设备之间发送错误消息和操作信息，比如网络拥塞或无法到达的主机。

	Address Resolution Protocol(ARP)：ARP用于在本地网络上将IP地址映射到物理MAC(媒体访问控制)地址。它使设备能够使用它们的MAC地址相互通信。

	Reverse Address Resolution Protocol(RARP)：RARP是一种用于在本地网络上将MAC地址映射到IP地址的协议。它主要用于旧系统中为无磁盘工作站获取IP地址。

	DHCP (Dynamic Host Configuration Protocol)。它是一种网络协议，用于自动分配IP地址和其他网络配置参数给网络上的设备。DHCP的主要功能是为设备提供自动化的IP地址分配。当设备连接到网络时，它可以向DHCP服务器发送一个请求，以获取可用的IP地址。DHCP服务器会从预定义的地址池中选择一个可用的IP地址，并将其分配给设备。这样，设备就可以在网络上进行通信。

	4.

Which features has IPv6 packet?

1.更大的地址空间

2.简化的头部格式

3.拓展头部

4.流标记

5.内置安全性

6.无状态地址配置

5.

![](https://i-blog.csdnimg.cn/blog_migrate/9a04600a2fe9bb22f2f0cdaa8930bf1f.png)

a. Dx(w) = 2, Dx(y)= 2+2 = 4, Dx(u) = min(Dx(w)+5,Dx(y)+6) = 7

b&c.注意题目要求，因为cost为正整数，因此最小值为1

b1&c1.考虑c(x,y)变化

因为Dx(w)>=1 , Dx(u) = min(Dx(w)+5,Dx(y)+6) = 7

不会产生更新

b2&c2.考虑c(x,w)变化

当c(x,w)6,Dx(u) = min(Dx(w)+5,Dx(y)+6) = 11 ,进行更新。

![](https://i-blog.csdnimg.cn/blog_migrate/49a95b1ba83c32e804dc2725abb989bd.png)

![](https://i-blog.csdnimg.cn/blog_migrate/040197bf13167c3c09e91f8c635a1604.png)

![](https://i-blog.csdnimg.cn/blog_migrate/3678482f85c35f6cf3256de53df3b863.png)

![](https://i-blog.csdnimg.cn/blog_migrate/00ea212f995a54a2cac1920d5ce48fbe.png)

![](https://i-blog.csdnimg.cn/blog_migrate/f1361509f82757d01bd3480b2c4d085b.png)
