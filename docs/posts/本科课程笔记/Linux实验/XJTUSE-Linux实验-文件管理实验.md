---
title: "XJTUSE-Linux实验-文件管理实验"
date: 2023-12-25 :52
tags:
- Linux实验
category: 本科课程笔记
order: 4
---

# XJTUSE-Linux实验-文件管理实验

本实验与前面实验有关系：

 [XJTUSE-Linux实验-进程管理实验-CSDN博客](https://blog.csdn.net/weixin_64112516/article/details/135151634)

## 实验目的
熟练掌握Linux操作系统的使用，掌握Linux的系统的进程管理和文件管理功能。

## 实验要求
完成实验内容并写出实验报告，报告应具有以下内容：

- 实验目的；- 实验内容；- 题目分析及基本设计过程分析；- 配置文件关键修改处的说明及运行情况，应有必要的效果截图；- 实验过程中出现的问题及解决方法；- 实验体会。
## 实验内容
- 将若干已有用户加入到同一个组xjtuse中。在/home下创建一个共享的公用目录public，允许xjtuse组中的用户对该目录具有读写和执行操作。(给出相关命令及运行结果)- 对于public目录下的文件，只有文件的拥有者才具有删除文件的权限。(给出相关命令及运行结果)- 对于public目录下的文件，也可以通过路径/mnt/public来访问。(给出相关命令及运行结果)- 看Linux系统磁盘空间的使用情况(给出显示结果)，并为/分区创建磁盘配额，使得用户可用空间的软限制为100M，硬限制为150M，且每个用户可用的inodes的软限制为100，硬限制为120。并对磁盘配额情况进行验证测试。(给出相关命令及运行结果)
## 任务一
### 设计思路
1.将已有的用户加到一个组里面，可以参考我之前做的进程管理实验。

2.创建目录，使用mkdir命令

3.配置目录权限

4.验证 ls /home -l

### 运行结果
查看之前的分组：

![](https://i-blog.csdnimg.cn/blog_migrate/6305f471bd9c4c8b4585e1e81745f195.png)

创建文件夹：

![](https://i-blog.csdnimg.cn/blog_migrate/4ca0496421eabd192d933cf15b99458d.png)配置权限：

![](https://i-blog.csdnimg.cn/blog_migrate/b1e7413fa0818ec1b5868fc614889c62.png)

验证：

![](https://i-blog.csdnimg.cn/blog_migrate/4d0a9989237a295d82a4f0475d5471c9.png)

完美完成！！！

## 任务二
### 设计思路
1.为其添加拥有者的权限

```
chmod +t /home/public

```
2.验证

```
su user1
touch /home/public/user1_file
su user2
rm -f /home/public/user2_file

```
### 运行结果
![](https://i-blog.csdnimg.cn/blog_migrate/b864116f0ba2e608a418dfb55400c5cc.png)

## 任务三
### 设计思路
1.创建软连接

```
ln -s /home/public /mnt/public

```
2.验证

### 运行结果
![](https://i-blog.csdnimg.cn/blog_migrate/a76d5e740d7bf3bd6006d4f4e75a1864.png)

## 任务四
### 设计思路
1.查看磁盘额度

```
df -h

```
2.挂载

```
mount -o remount,usrquota,grpquota /

```
3.创建磁盘配额

```
quotacheck -m /
edquota -u user1
```
### 运行结果
![](https://i-blog.csdnimg.cn/blog_migrate/50b5b4b5ed9e3d8fbd5bf2bcf4235e9a.png)

挂载

![](https://i-blog.csdnimg.cn/blog_migrate/455085ee124c1d25894f6abe90fb9a4f.png)

配置

![](https://i-blog.csdnimg.cn/blog_migrate/f13a74bd2dbb21c3f07fec2e9ed2dbe5.png)

![](https://i-blog.csdnimg.cn/blog_migrate/ebc2ecd3c40e604668ddebd94e738a28.png)

其他的用户一样设计。
