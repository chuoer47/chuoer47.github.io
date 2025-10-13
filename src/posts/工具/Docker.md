---
title: Docker
date: 2024-06-18
tags: code
category: 工具
description: Docker的使用指南
---

<!--more--->

# Docker

## 一、Dcoker介绍

Docker是基于Go语言开发的开源应用容器引擎，遵从Apache Licence 2.0协议，可以让开发者打包应用以及应用的依赖包到一个可移植的容器中，然后发布到各种发行版本的Linux系统上。

​		软件开发中最为麻烦的事情可能就是配置环境了。由于用户使用的操作系统具有多样性，即便使用跨平台的开发语言（如Java和Python）都不能保证代码能够在各种平台下都可以正常的运转，而且在不同的环境下我们安装的软件需要依赖的软件包也是不一样的。

那么问题来了，我们安装软件的时候可不可以把软件运行的环境一并安装？我们是不是可以把原始环境一模一样地复制过来呢？

- 虚拟机（virtual machine）就是带环境安装的一种解决方案，它可以在一种操作系统里面运行另一种操作系统，比如在Windows系统里面运行Linux系统，在macOS上运行Windows，而应用程序对此毫无感知。使用过虚拟机的人都知道，虚拟机用起来跟真实系统一模一样，而对于虚拟机的宿主系统来说，虚拟机就是一个普通文件，不需要了就删掉，对宿主系统或者其他的程序并没有影响。但是虚拟机通常会占用较多的系统资源，启动和关闭也非常的缓慢，总之用户体验并没有想象中的那么好。

- Docker属于对Linux容器技术（LXC）的一种封装（利用了Linux的namespace和cgroup技术），它提供了简单易用的容器使用接口，是目前最流行的 Linux 容器解决方案。Docker将应用程序与该程序的依赖打包在一个文件里面，运行这个文件，就会生成一个虚拟容器。程序在这个虚拟容器里运行，就好像在真实的物理机上运行一样。下图是虚拟机和容器的对比，左边是传统的虚拟机，右边是Docker。

![](/image\docker4.png)

::: info Docker主要用于几下几个方面

1. 提供一次性的环境。
2. 提供弹性的云服务（利用Docker很容易实现扩容和收缩）。
3. 实践微服务架构（隔离真实环境在容器中运行多个服务）。

:::

## 二、Docker安装

### 1、卸载老版本

ubuntu下自带了docker的库，不需要添加新的源。但是ubuntu自带的docker版本太低，需要先卸载旧的再安装新的。

```shell
apt-get remove docker docker-engine docker.io containerd runc
```

### 2、更新软件包

```shell
sudo apt update
sudo apt upgrade
```

### 3、安装docker依赖

安装工具：

```shell
apt-get -y install apt-transport-https ca-certificates curl software-properties-common
```

```shell
apt-get install ca-certificates curl gnupg lsb-release
```

### 4、添加Docker官方GPG密钥

```shell
curl -fsSL http://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo apt-key add -
```

### 5、添加docker软件源

```shell
sudo add-apt-repository "deb [arch=amd64] http://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable"
```

### 6、安装docker

```shell
apt-get install docker-ce docker-ce-cli containerd.io
```

### 7、配置用户组（可选）

默认情况下，只有root用户和docker组的用户才能运行Docker命令。我们可以将当前用户添加到docker组，以避免每次使用Docker时都需要使用sudo

```shell
sudo usermod -aG docker $USER
```

注意：重新登录才能使更改生效。

### 8、启动

::: info 运行docker

```Bash
# 启动Docker
systemctl start docker

# 停止Docker
systemctl stop docker

# 重启
systemctl restart docker

# 设置开机自启
systemctl enable docker

# 执行docker ps命令，如果不报错，说明安装启动成功
docker ps
```

:::

验证是否成功:

```shell
sudo docker run hello-world
```

查看版本:

```shell
sudo docker version
```

查看镜像:

上面我们拉取了hello-world的镜像，现在我们可以通过命令来查看镜像，命令如下：

```shell
sudo docker images
```

### 9、配置镜像加速

打开阿里云->产品->容器->容器镜像服务ACR->镜像工具下的配置镜像加速

## 三、docker基础

### 1、快速入门

docker安装mysql

```shell
docker run -d \
 --name mysql \
 -p 3306:3306 \
 -e TZ=Asia/Shanghai \
 -e MYSQL_ROOT_PASSWORD=12345678 \
 mysql
 
```

**解释：**

- `docker run`: 创建并运行一个容器， `-d`是让容器在后台运行
- `--name mysql`:给容器起名字，必须唯一
- `-p 3306:3306`设置端口映射     -> 将宿主机器的3306端口和容器内3306端口进行映射
- `-e KEY=VALUE`:环境变量设置
- `mysql`：指定运行的镜像的名字  
  - 镜像名称：[repository]:[tag] 
    - repository:镜像名
    - tag:镜像的版本
  - 没有指定tag时，默认是latest，代表最新版本的镜像

### 2、常见命令

![](/image\docker1.png)

#### 1）容器操作

docker container基本命令

```shell
# 创建docker容器
docker container run ubuntu

# 关闭容器
docker container stop 94...(编号)

# 查看所有容器
docker container ps/ls -a
	# 新版本推荐ls,不加-a只显示已开启的镜像
	
# 删除容器
docker container rm 94....
docker rm 94

#进入容器
docker exec -it 容器名 bash
```

多容器操作

```sh
# 关闭多个容器（笨方法）
docker container stop 36 94 5d

# 显示所有容器id
docker container ps -aq

# 关闭所有容器
docker container stop $(docker container ps -aq)

# 删除所有容器，正在使用的也删除
docker [container] rm $(docker container ps -aq)
# 不停止直接删除会报错,需要在后面加上-f
docker [container] rm 94 -f
```

端口映射

```sh
# 端口映射         服务器端口:容器端口
docker [container] run -p 80:80 nginx    # 前台运行模式
	#访问 127.0.0.1

docker [container] run -d -p 90:80 nginx	# 后台运行模式
	# 127.0.0.1:90

# 将后台运行模式转变成前台运行模式
docker [container] attach 54(id) 
```



后台模式下操作

```shell
# 查看日志
docker [container] logs 43

# 跟踪日志
docker [container] logs -f 43
```

#### 2）镜像操作

```shell
# 拉取镜像,不同版本有区别,后面可以加版本号
docker pull wordpress
docker image pull wordpress

# 查看镜像详细信息
docker [image] inspect b94

#删除镜像
docker image rm b94
docker rmi b94
```

镜像导入导出

```shell
#导出镜像,先进入要导出到的目录
docker [image] save wordpress:latest -o mywordpress.image

#导入镜像
docker [image] load -i .\mywordpress.image
```



### 3、数据卷

数据卷（volume）是一个虚拟目录，是容器内目录与宿主机目录之间映射的桥梁

![](/image\docker2.png)

 数据卷命令

```bash
docker volume create #创建数据卷

docker volume ls #查看所有数据卷

docker volume rm #删除指定数据卷

docker volume inspec #查看某个数据卷详情

docker volume prune #清除数据卷
```

::: warning

- 只有在容器创建的时候才可以挂载，使用`-v 数据卷:容器内目录`
- 当创建容器时，如果挂载了数据卷且数据卷不存在，会自动创建数据卷

:::

::: tip 本地目录与容器内目录的挂载

- 在执行`docker run`命令时，使用 `-v 本地目录:容器内目录` 可以完成本地目录挂载
- 本地目录必须以“/”或"./”开头，如果直接以名称开头，会被识别为数据卷而非本地目录
  - `-v mysql:/var/lib/mysq`l 会被识别为一个数据卷叫mysql
  - `-v ./mysql:/var/lib/mysql` 会被识别为当前目录下的mysql目录

:::

### 4、自定义镜像

镜像就是包含了应用程序、程序运行的系统函数库、运行配置等文件的文件包。构建镜像的过程其实就是把上述文件打包的过程。

#### 1）Dockerfile常见指令

| 指令       | 说明                                       | 示例                                                         |
| ---------- | ------------------------------------------ | ------------------------------------------------------------ |
| FROM       | 指定基础镜像                               | FROM  centos:6                                               |
| ENV        | 设置环境变量                               | ENV  key  value                                              |
| COPY       | 拷贝本地文件到镜像的指定目录               | COPY  ./jrell.tar.gz  /tmp                                   |
| RUN        | 执行Linux的shell命令，一般是安装过程的命令 | RUN  tar  -zxvf  /tmp/jrell.tar.gz  && EXPORTS  path=/tmp/jrell:$path |
| EXPOSE     | 指定容器运行时监听的端口，给镜像使用者看的 | EXPOSE  8080                                                 |
| ENTRYPOINT | 镜像中应用的启动命令，容器运行时调用       | ENTRYPOINT  java  -jar  xx.jar                               |

更多详细说明，请参看官网文档：[https://docs.docker.com/engine/reference/builder](https://docs.docker.com/engine/reference/builder)

#### 2）利用Dockerfile构建镜像

```shell
# 从Dockerfile构建镜像
docker [image] build -t myImage:1.0 .
docker [image] build -f Dockerfile -t test .
```

::: tip 

- `-t`是给镜像起名，格式依然是repository:tag的格式，不指定tag时默认为latest
- `.`指定Dockerfile所在目录，如果就在当前目录，则指定为"."

:::

镜像上传：

```shell
# 修改镜像名字,上传到dockerhub上要遵守命名规范
docker image tag test ruyiwei/test

# 上传到dockerhub
docker login  # 登录
docker image push ruyiwei/test	# 上传
```

#### 3）示例

基于docker部署web应用：

Dockerfile:

```dockerfile
# 基础镜像
FROM openjdk:11.0-jre-buster
# 设定时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
# 拷贝jar包
COPY docker-demo.jar /app.jar
# 入口
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

进入镜像目录，构建镜像:

```bash
docker build -t docker-demo:1.0 .

# 直接指定Dockerfile目录
docker build -t docker-demo:1.0 /root/demo
```

最后运行该镜像

```bash
# 创建并运行容器
docker run -d --name dd -p 8080:8080 docker-demo:1.0
```



### 5、容器网络互联

加入自定义网络的容器才可以通过容器名互相访问，Docker的网络操作命令如下:

| 命令                      | 说明                 |
| ------------------------- | -------------------- |
| docker network create     | 创建一个网络         |
| docker network ls         | 查看所有网络         |
| docker network rm         | 删除指定网络         |
| docker network prune      | 清除未使用的网络     |
| docker network connect    | 使指定容器加入某网络 |
| docker network disconnect | 使指定容器离开某网络 |
| docker network inspect    | 查看网络详细信息     |

示例：

```bash
# 1.首先通过命令创建一个网络
docker network create hmall

# 2.然后查看网络
docker network ls
# 结果：
NETWORK ID     NAME      DRIVER    SCOPE
639bc44d0a87   bridge    bridge    local
403f16ec62a2   hmall     bridge    local
0dc0f72a0fbb   host      host      local
cd8d3e8df47b   none      null      local
# 其中，除了hmall以外，其它都是默认的网络

# 3.让dd和mysql都加入该网络，注意，在加入网络时可以通过--alias给容器起别名
# 这样该网络内的其它容器可以用别名互相访问！
# 3.1.mysql容器，指定别名为db，另外每一个容器都有一个别名是容器名
docker network connect hmall mysql --alias db
# 3.2.db容器，也就是我们的java项目
docker network connect hmall dd

# 4.进入dd容器，尝试利用别名访问db
# 4.1.进入容器
docker exec -it dd bash
# 4.2.用db别名访问
ping db
# 结果
PING db (172.18.0.2) 56(84) bytes of data.
64 bytes from mysql.hmall (172.18.0.2): icmp_seq=1 ttl=64 time=0.070 ms
64 bytes from mysql.hmall (172.18.0.2): icmp_seq=2 ttl=64 time=0.056 ms
# 4.3.用容器名访问
ping mysql
# 结果：
PING mysql (172.18.0.2) 56(84) bytes of data.
64 bytes from mysql.hmall (172.18.0.2): icmp_seq=1 ttl=64 time=0.044 ms
64 bytes from mysql.hmall (172.18.0.2): icmp_seq=2 ttl=64 time=0.054 ms
```

::: tip 总结：

- 在自定义网络中，可以给容器起多个别名，默认的别名是容器名本身
- 在同一个自定义网络中的容器，可以通过别名互相访问

:::

### 6、DockerCompose

Docker Compose通过一个单独的docker-compose.ymL模板文件(YAML格式)来定义一组相关联的应用容器，帮助我们实现**多个相互关联的Docker容器的快速部署。**

![](/image\docker3.png)

示例：

```yaml
version: "3.8"

services:
  mysql:
    image: mysql
    container_name: mysql
    ports:
      - "3306:3306"
    environment:
      TZ: Asia/Shanghai
      MYSQL_ROOT_PASSWORD: 123
    volumes:
      - "./mysql/conf:/etc/mysql/conf.d"
      - "./mysql/data:/var/lib/mysql"
      - "./mysql/init:/docker-entrypoint-initdb.d"
    networks:
      - hm-net
  hmall:
    build: 
      context: .
      dockerfile: Dockerfile
    container_name: hmall
    ports:
      - "8080:8080"
    networks:
      - hm-net
    depends_on:
      - mysql
  nginx:
    image: nginx
    container_name: nginx
    ports:
      - "18080:18080"
      - "18081:18081"
    volumes:
      - "./nginx/nginx.conf:/etc/nginx/nginx.conf"
      - "./nginx/html:/usr/share/nginx/html"
    depends_on:
      - hmall
    networks:
      - hm-net
networks:
  hm-net:
    name: hmall
```

docker compose 命令格式：

```shell
docker compose [OPTIONS] [COMMAND]
```

- `Options`
  - `-f`指定compose文件的路径和名称
  - `-p`指定project名称

- `Commands`
  - `up` 创建并启动所有service容器
  - `down`停止并移除所有容器，网络
  - `ps`列出所有启动的容器
  - `logs`查看指定容器的日志
  - `stop`停止容器
  - `start`启动容器
  - `restart` 重启容器
  - `top`查看运行的进程
  - `exec`在指定的运行中容器中执行命令

**示例：** 使用DockerCompose部署minio

docker-compose.yml文件

```yaml
version: '3'
services:
  minio:
    image: minio/minio
    container_name: minio
    volumes:
      - /root/minio/data1:/data1
      - /root/minio/data2:/data2
      - /root/minio/data3:/data3
    command: server --console-address ":9001" /data1 /data2 /data3
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ACCESS_KEY: minio
      MINIO_SECRET_KEY: minio
    networks:
       - hm-net
networks:
  hm-net:
    external: true
```

启动：

```bash
docker compose up -d  #-d是后台启动
```

其他命令：

```bash
# 查看镜像
docker compose images
#查看配置: 
docker-compose config
# 后台启动: 
docker-compose up -d
# 构建镜像: 
docker-compose build
# 下载镜像: 
docker-compose pull
# 查看正在运行: 
docker-compose ps
```

## 四、案例

### 1、部署mysql

首先启动一个mysql并复制配置文件到宿主机器

```bash
docker cp mysql:/var/lib/mysql /root/mysql/data
docker cp mysql:/etc/mysql/conf.d /root/mysql/conf
docker cp mysql:/docker-entrypoint-initdb.d /root/mysql/init
```

之后删除之前的容器，并重新按以下命令启动

```bash
docker run -d \
  --name mysql \
  -p 3306:3306 \
  -e TZ=Asia/Shanghai \
  -e MYSQL_ROOT_PASSWORD=123 \
  -v /root/mysql/data:/var/lib/mysql \
  -v /root/mysql/conf:/etc/mysql/conf.d \
  -v /root/mysql/init:/docker-entrypoint-initdb.d \
  --network hm-net\
  mysql
```

### 2、nginx

拷贝要挂载的文件

```bash
docker cp nginx:/etc/nginx /root/nginx_blog/conf
docker cp nginx:/usr/share/nginx/html /root/nginx_blog/html
docker cp nginx:/var/log/nginx /root/nginx_blog/logs
```

启动

```bash
docker run -d \
-p 80:80 \
--name nginx_blog \
-v /root/nginx_blog/html:/usr/share/nginx/html \
-v /root/nginx_blog/logs:/var/log/nginx \
-v /root/nginx_blog/conf:/etc/nginx \
nginx
```

### 3、seata

```
docker run --name seata \
-p 8099:8099 \
-p 7099:7099 \
-e SEATA_IP=ipaddr \
-v ./seata:/seata-server/resources \
--privileged=true \
--network hm-net \
-d \
seataio/seata-server:1.5.2
```

### 4、nacos

```
docker run -d \
--name nacos \
--env-file ./nacos/custom.env \
-p 8848:8848 \
-p 9848:9848 \
-p 9849:9849 \
--restart=always \
--network hm-net\
nacos/nacos-server:v2.1.0-slim
```

### 5、sentinel

dockerfile:

```dockerfile
# 基础镜像
FROM openjdk:11.0-jre-buster
# 设定时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
# 拷贝jar包
COPY sentinel-dashboard.jar /app.jar
# COPY run.sh /run.sh
# 入口
# ENTRYPOINT ["sh",  "/run.sh"]
ENTRYPOINT ["java", "-Dserver.port=8090", "-Dcsp.sentinel.dashboard.server=localhost:8090", "-Dproject.name=sentinel-dashboard", "-jar", "/app.jar"]
```

### 6、xxl-job

```bash
 docker run -d \
 -e PARAMS="--spring.datasource.url=jdbc:mysql://mysql:3306/xxl_job?Unicode=true&characterEncoding=UTF-8 --spring.datasource.username=root --spring.datasource.password=123" \
 -p 8088:8080 \
 -v /root/xxl-job:/data/applogs \
 --name xxl-job \
 --privileged=true \
 --network hm-net \
 xuxueli/xxl-job-admin:2.3.1
```

