---
title: "VMware 配置 Linux 虚拟机"
date: 2024-01-01
tags:
- linux
- 虚拟机
category:
- 工具
order: 6
---

# VMware 配置 Linux 虚拟机

主要写一下自己在配置虚拟机的过程和问题，说实话，这东西是真的难配置。

## 配置过程

主要就是参考下面这篇 blog

[VMware 虚拟机安装 Ubuntu20.04 详细图文教程](https://blog.csdn.net/weixin_41805734/article/details/120698714)

## 问题

### 问题 1

问题描述：使用 vi 命令进入文件后，发现**键盘的上下左右是 wsad，**上网搜索，解决 blog 如下：

[解决 ubuntu 用 vim 编辑时退格键和上下左右键失灵的问题](https://blog.csdn.net/qq_29750461/article/details/128347431)

有关 vim 的基础知识如下：

[Linux 工具 vim 的操作介绍](https://blog.csdn.net/kristin_en/article/details/128899450)

### 问题 2

问题描述：在桌面进入终端，进入的是用户，没有办法进入 root，即使 su -，也不行。

解决办法如下：

[VMware Ubuntu root 密码是什么，怎么进入 root 账户](https://blog.csdn.net/qq_45476428/article/details/133802656)

### 问题 3

问题描述：从桌面进入终端，停留在 /home/user 中，操作不方便

解决办法：

直接 cd .. 几次即可。

### 问题 4

问题描述：有时候使用 apt-get 命令无法下载，如果看英文的话可以知道是连接不上服务器。

解决办法：需要修改一下镜像源。



### 问题 5

没有网络？无法与主机联系？

解决办法：

1. 设置桥接模式（桥接就是把一台机器上的若干个网络接口"连接"起来。其结果是，其中一个网口收到的报文会被复制给其他网口并发送出去。以使得网口之间的报文能够互相转发。）





2. 可以设置 CD/DVD


