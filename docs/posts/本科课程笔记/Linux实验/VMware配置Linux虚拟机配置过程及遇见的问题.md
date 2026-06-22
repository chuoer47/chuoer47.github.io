---
title: "VMware配置Linux虚拟机配置过程及遇见的问题"
date: 2023-12-21 :38
tags:
- Linux实验
category: 本科课程笔记
order: 1
---

# VMware配置Linux虚拟机配置过程及遇见的问题

主要写一下自己在配置虚拟机的过程和问题，说实话，这东西是真的难配置。

###
### 配置过程
主要就是参考下面这篇blog

[VMware虚拟机安装Ubuntu20.04详细图文教程_vmware ubuntu-CSDN博客](https://blog.csdn.net/weixin_41805734/article/details/120698714?csdn_share_tail=%7B%22type%22%3A%22blog%22%2C%22rType%22%3A%22article%22%2C%22rId%22%3A%22120698714%22%2C%22source%22%3A%22echoelly%22%7D&fromshare=blogdetail)

### 问题
#### 问题1
问题描述：使用vi命令进入文件后，发现键盘的上下左右是wsad，上网搜索，解决blog如下：

[【解决】ubuntu用vim编辑时退格键和上下左右键失灵的问题_ubuntu编辑时删除键-CSDN博客](https://blog.csdn.net/qq_29750461/article/details/128347431?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522170312139616800226569356%2522%252C%2522scm%2522%253A%252220140713.130102334..%2522%257D&request_id=170312139616800226569356&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~sobaiduend~default-1-128347431-null-null.142%5Ev96%5Epc_search_result_base7&utm_term=ubuntu18.04%E7%9A%84vim%E4%B8%8A%E4%B8%8B%E5%B7%A6%E5%8F%B3&spm=1018.2226.3001.4187)

有关vim的基础知识如下：

[【Linux工具】vim的操作介绍_vim 上下左右-CSDN博客](https://blog.csdn.net/kristin_en/article/details/128899450)

###
#### 问题2
问题描述：在桌面进入终端，进入的是用户，没有办法进入root，即使su -，也不行。

解决办法如下：

[VMware _ Ubuntu _ root 密码是什么，怎么进入 root 账户_虚拟机查看root密码-CSDN博客](https://blog.csdn.net/qq_45476428/article/details/133802656)

#### 问题3
问题描述：从桌面进入终端，停留在/home/user中，操作不方便

解决办法：

直接cd ..几次即可。

#### 问题4
问题描述：有时候使用apt-get命令无法下载，如果看英文的话可以知道是连接不上服务器。

解决办法：需要修改一下镜像源。

![](https://i-blog.csdnimg.cn/blog_migrate/82c7a35e7464381d65ad9265c5273239.png)

#### 问题5
没有网络？无法与主机联系？

解决办法：

1.设置桥接模式(桥接就是把一台机器上的若干个网络接口“连接”起来。其结果是，其中一个网口收到的报文会被复制给其他网口并发送出去。以使得网口之间的报文能够互相转发。)

![](https://i-blog.csdnimg.cn/blog_migrate/d289da8c213bad6b6269f192a0116957.png)

![](https://i-blog.csdnimg.cn/blog_migrate/6bda6b34df317710e14957c414932835.png)

2.可以设置CD/DVD

![](https://i-blog.csdnimg.cn/blog_migrate/3eb94e22a57a263036b5589cc11b3920.png)
