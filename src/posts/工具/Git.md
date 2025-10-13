---
title: Git
date: 2024-05-22 16:32:00
tags: code
category: 工具
description: Git的使用指南
---

<!--more--->

# Git

## 1、全局配置

```shell
git config --global user.name "******"  //用户名
	//git config --global user.name  查看用户名
git config --global user.email "1*******@qq.com"  // 邮箱
```

## 2、创建仓库

```shell
//1、Git仓库初始化（让Git知道，他需要来管理这个目录）
git init             // 创建 .git 隐藏目录


//2、Git常用指令操作
git status    //查看当前状态

git add 文件名  //添加到缓冲区，可以同时添加多个文件
	git add 文件名1 文件名2 文件名3 ...
	git add . //添加当前目录到缓存区
	
git commit -m "注释内容"   //提交至版本库

```

## 3、版本回退

```shell
//1、查看版本
git log
git log --pretty=oneline    //推荐

//2、回退操作
git reset --hard 提交编号
	git reset --hard dfec13ece6eb6ec47d422afac1d340df8dffba4b
```

`注意`: 回到过去之后，要想再回到之前最新的版本的时候，则需要使用指令去查看历史操作,以得到最新的commit id。

```shell
git reflog
```

之后在使用`git reset --hard` 

> 要想回到过去，必须先得到commit id，然后通过git reset --hard进行回退
>
> 要想回到未来，需要使用 git reflog进行历史操作查看，得到最新的commit id;
>
> 在写回退指令的时候commit id可以不用写全，git自动识别，但是也不能写太少，至少需要写前4位字符



## 4、Git远程仓库创建

### 1）HTTP

`a,`创建空目录，和github仓库名称一样

`b,`使用clone指令克隆线上仓库到本地

```shell
git clone 线上仓库地址
```

`c,`在仓库上对应操作（提交暂存区、提交本地仓库、提交线上仓库、拉取线上仓库）

```shell
//1、提交暂存区、提交本地仓库

//2、提交线上仓库
git push

//首次提交
//修改 ".git/config" 文件
url = https://用户名:密码@github.com/用户名/仓库名.git
账号密码特殊字符要进行编码:
!    #    $     &    '    (    )    *    +    ,    /    :    ;    =    ?    @    [    ]
%21  %23  %24   %26  %27  %28  %29  %2A  %2B  %2C  %2F  %3A  %3B  %3D  %3F  %40  %5B  %5D


//3、拉取线上仓库
git pull

//拉取指定分支
git pull origin <远程分支名>:<本地分支名>
git pull origin <远程分支名>
```

### 2)SSH（推荐）

创建秘钥

```shell
ssh-keygen -t rsa -C "***@cherish.pw"
```

复制`id_rsa.pub`内容，并在github添加SSH key

之后`git clone` 

```shell
 git clone git@github.com:weiruyi/shop.git
```

之后正常   提交暂存区、提交本地仓库、提交线上仓库、拉取线上仓库

### 3)关联远程仓库

```bash
// -b branch 指定分支
git clone -b branch 远程仓库地址

//绑定远程仓库
git remote add origin  https://xxxxxxxxx.git\
//关联分支，绑定仓库之后使用
git branch --set-upstream-to=origin/develop develop
```

### 5、分支管理

```shell
//分支相关指令:
git branch 		//查看分支
git branch 分支名  //创建分支
git checkout 分支名  //切换分支
git branch -d分支名  //删除分支   删除的时候一定要先退出当前分支
git merge 被合并的分支名  //合并分支
```

对于新分支,可以使用“`git checkout -b 分文名`”格令来切换分支，`-b`选项表示创建并切换,相当于是两个操作指令。



## 6、冲突的产生与解决

解决冲突：

**a**,先`git pull`

​		将线上与本地仓库的冲突合并到对应文件中

**b**,打开冲突文件，解决冲突

​	和提交者商量，看代码如何保留，将改好的文件再次提交

**c**,重新提交

