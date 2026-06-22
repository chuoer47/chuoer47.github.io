---
title: "XJTUSE - 21 级 Linux 综合实验"
date: 2024-03-15 :58
tags:
- Linux实验
category: 本科课程笔记
order: 2
---

# XJTUSE - 21 级 Linux 综合实验

## 前言
拖更了好久，本来应该在假期就写完的，只能说我太懒了。不过问题也不大，反正是给22级以后的学弟学妹看的，希望该blog对大家的Linux综合实验有着抛砖引玉的作用，也希望大家不要直接照抄，开发脑筋，多多实践。

实验目的

熟练掌握 Linux 操作系统的使用，掌握 Linux 的各项系统管理功能，掌握 Linux 下各类网络服务的安装、配置以及使用，并能用 shell 脚本实现简单的管理任务。

## 实验要求
完成实验内容并写出实验报告，报告应具有以下内容：

-  实验目的；

 -  实验内容；

 -  题目分析及基本设计过程分析；

 -  配置文件关键修改处的说明及运行情况，应有必要的效果截图；

 -  脚本源程序清单，包括详细注释；

 -  实验过程中出现的问题及解决方法；

 -  实验体会。

## 实验内容
准备工作：利用虚拟机安装 Linux 操作系统，在系统中安装适当的软件包以备后续的实验需要，可关闭防火墙和 SeLinux。

假设在一个小型软件公司中，有一个 leader、若干开发人员和测试人员。根据所学内容，使用一种或多种服务(如 ftp、samba、Http 等)搭建服务器，完成下述功能：

-  开发人员能实现所编代码的上传，以“开发人员姓名+功能”命名代码。开发人员能看到所有代码列表，但是不能下载其他用户的代码。

 -  在指定的代码提交时间到时，运行脚本自动统计上传代码的开发人员名字、人数和提交时间，生成文档，供测试人员和 leader 查看。

 -  测试人员能够查看提交的代码，但无权修改代码，可选择一个代码进行测试。被选中测试的代码从当前目录清除，放入一个指定的新目录中。测试后生成相应的测试报告，以“开发人员姓名+功能+测试人员姓名”命名，并发布在某个指定的目录中，供开发人员查看。

 -  根据测试报告，生成测试记录文件，记录哪个测试人员测试了哪个开发人员的哪个代码以及处理时间。

(注：可以根据题目要求，自己创建相关用户，设定相关目录和权限)

## 虚拟机配置
-  本次实验使用的虚拟机为 VMware 虚拟机

 -  安装的操作系统为 Ubuntu20.04

配置如下：

![](https://i-blog.csdnimg.cn/blog_migrate/3f2b914ffa4116c58a01a1a07946477f.png)

## 虚拟机用户设置
### 用户创建
在虚拟机上创建四个用户，分别为 tester1，tester2，developer1，developer2(假设密码均为 123456)，使用的命令如下：

```
useradd -m tester1
passwd tester1
useradd -m tester2
passwd tester2
useradd -m developer1
passwd developer1
useradd -m developer2
passwd developer2
```
命令解释如下：

当创建用户时，可以使用 useradd 命令来在 Linux 系统上添加新用户。以下是对 useradd 命令中常用选项的解释：

-  -m：此选项指示 useradd 命令在创建用户时同时创建用户的家目录。如果省略该选项，将不会创建用户的家目录。

 -  username：这是要创建的新用户的用户名。您可以替换它为您希望使用的任何用户名。

 -  passwd：这是用于设置用户密码的命令。通过运行 passwd 命令，您可以为新用户设置密码，这是登录到系统所需的凭据。

展示如下：

![](https://i-blog.csdnimg.cn/blog_migrate/c6c9c144ef3c2250a335e3fc1d9efce7.png)

![](https://i-blog.csdnimg.cn/blog_migrate/f8a492b06989b2e31773385b3a256c2c.png)

可以看到每个用户都有自己的工作目录，方便后续的文件管理。

### 分组
在虚拟机上创建两个组，分别为 testers 和 developers，并且添加用户。命令如下：

```
groupadd testers
groupadd developers
usermod -aG testers tester1
usermod -aG testers tester2
usermod -aG developers developer1
usermod -aG developers developer2
```
命令解释如下：

-  usermod：这是用于修改用户属性的命令。在添加用户到 sudo 组时，使用 usermod 命令可以将用户添加到指定的组。

 -  -aG：这是 usermod 命令的选项之一，用于将用户添加到指定的组。-a 选项表示追加到组，-G 选项指定要添加到的组的名称。

 -  groupadd：该命令可以创建新的用户组

现在在虚拟机上，我们有了四个用户，拥有单独的工作文件夹，同时，进行了分组。

![](https://i-blog.csdnimg.cn/blog_migrate/f3e7b3f4021a6e56087ff800681e9c37.png)

## Samba 用户设置
现在我们要将 Samba 的用户设置与虚拟机用户设置进行匹配，以完成后续的工作。

### 用户创建
在 Samba 服务上创建四个用户，分别为 tester1，tester2，developer1，developer2(假设密码均为 123456)，使用的命令如下：

```
smbpasswd -a tester1
smbpasswd -a tester2
smbpasswd -a developer1
smbpasswd -a developer2
```
命令解释如下：

-  smbpasswd 是用于管理 Samba 用户密码的命令。

 -  -a 选项表示要添加或更改用户密码。

 -  Username 是要添加或更改密码的 Samba 用户名。

![](https://i-blog.csdnimg.cn/blog_migrate/791a3a453d2526df1f23245e6d9f0750.png)

### 分组
在 Samba 上进行 testers 和 developers 分组。命令如下：

```
gpasswd -a tester1 testers
gpasswd -a tester2 testers
gpasswd -a developer1 developers
gpasswd -a developer2 developers
```
解释命令(以第一条为例)：

-  gpasswd 是用于管理用户组的命令。

 -  -a 选项表示要添加用户到用户组。

 -  tester1 是要添加到用户组中的用户名。

 -  testers 是目标用户组的名称。

![](https://i-blog.csdnimg.cn/blog_migrate/6c7959fc575aed326880cb114cbd2912.png)

## 文件夹管理
### 文件夹创建
根据题目要求，明显可以得到三个文件夹：

-  一个供开发者开发完成后上传使用取名为 developUse

 -  一个供测试人员测试完成后将代码转移的文件，取名为 finished

 -  一个用来存放测试报告的文件夹，取名为 testReport

创建命令如下：

```
mkdir -p /home/developUse
mkdir -p /home/finished
mkdir -p /home/testReport
```
解释命令：

-  mkdir 命令用于创建新的目录。但是，当您想要创建一个目录树(即包含多个子目录的目录结构)时，如果不使用-p 选项，您必须先创建每个子目录，然后再创建父目录。而使用 mkdir -p 命令，您可以一次性创建整个目录树。

 -  -p 选项告诉 mkdir 命令递归地创建目录结构。如果所需的目录已存在，该命令将忽略它们而不会引发错误。如果目录不存在，它们将被一次性创建。

运行结果如下：

![](https://i-blog.csdnimg.cn/blog_migrate/f4261cf2670ac6ce805a243bfbd1fb3d.png)

![](https://i-blog.csdnimg.cn/blog_migrate/c1e6981570e823f227a3c7340d849519.png)

### 文件夹权限配置
为了权限分配和后续的 Samba 服务，设置文件夹的权限，命令如下：

```
chmod 777 /home/developUse
chmod 777 /home/finished
chmod 777 /home/testReport
chmod o+t /home/developUse
chmod o+t /home/finished
chmod o+t /home/testReport
chmod g+s /home/developUse
chmod g+s /home/finished
chmod g+s /home/testReport
```

命令解释：

-  `chmod`是用于修改文件或目录权限的命令。

 -  `777`表示目标文件或目录的权限值。

 -  `o+t`表示要设置目录的"Sticky"权限。`o`代表"其他人"，`+t`表示添加"Sticky"权限。

 -  `g+s`表示要设置目录的组执行权限。`g`代表"组"，`+s`表示添加组执行权限。

额外解释：

 在 Linux 的权限系统中，权限值由三个数字组成，分别代表所有者、所属组和其他人的权限。每个数字可以是 0 到 7 之间的一个值，对应不同的权限组合。

 -  7 表示读取(r)、写入(w)和执行(x)权限都被授予。

 -  6 表示读取和写入权限被授予，但没有执行权限。

 -  5 表示读取和执行权限被授予，但没有写入权限。

 -  4 表示仅读取权限被授予，没有写入和执行权限。

 -  3 表示写入和执行权限被授予，但没有读取权限。

 -  2 表示仅写入权限被授予，没有读取和执行权限。

 -  1 表示仅执行权限被授予，没有读取和写入权限。

 -  0 表示没有任何权限被授予。

运行结果：

![](https://i-blog.csdnimg.cn/blog_migrate/93f22328194c9354e493f8d91530fe5f.png)

为每一个用户分配自己的主目录，命令如下：

```
chown -R developer1:developer1 /home/developer1
chown -R developer2:developer2 /home/developer2
chown -R tester1:tester1 /home/tester1
chown -R tester2:tester2 /home/tester2
```

![](https://i-blog.csdnimg.cn/blog_migrate/ba330134100e724f50e27fff68ac2b7e.png)

### Samba 配置文件
配置 /etc/samba/smb.conf ，配置文件的添加内容如下：

```
[developUse]
comment = developUse
path = /home/developUse
valid users = @developers,@testers
create mask = 0640
writable = yes

[finished]
comment = finished
path = /home/finished
valid users = @developers,@testers
writable = yes

[testReport]
comment = testReport
path = /home/testReport
valid users = @developers,@testers
writable = yes
```

解释内容：

该配置文件定义了三个共享目录：developUse、finished 和 testReport。让我们逐个解释每个部分的含义：

-  [developUse]部分：

-  comment 字段为共享目录提供了一个注释或描述。

 -  path 字段指定了实际文件系统中的目录路径，即/home/developUse。

 -  valid users 字段指定了允许访问此共享目录的用户或用户组，这里是@developers 和@testers，表示只有属于这两个用户组的用户可以访问。

 -  create mask 字段指定了新创建的文件的权限掩码，即 0640，表示文件所有者具有读写权限，而所属组和其他用户只具有读权限。

 -  writable 字段设置为 yes，表示允许用户对该共享目录进行写操作。

-  [finished]部分：

-  comment、path 和 writable 字段具有类似的含义，用于定义 finished 共享目录。

 -  valid users 字段指定了允许访问此共享目录的用户或用户组，同样是@developers 和@testers。

-  [testReport]部分：

-  comment、path 和 writable 字段用于定义 testReport 共享目录。

 -  valid users 字段指定了允许访问此共享目录的用户或用户组，同样是@developers 和@testers。

这些配置指定了每个共享目录的注释、路径、访问权限和允许访问的用户或用户组。这样配置后，只有 developers 和 testers 用户组中的用户才能访问这些共享目录，并且具有相应的权限。其他用户将被拒绝访问或修改这些共享目录。

运行结果如下：

![](https://i-blog.csdnimg.cn/blog_migrate/b3f95b1dbfce3ec11e39b200c184bca5.png)

## 功能--developUse 文件夹
### developer1 上传文件
假设 develop1 上传了一个文件，上传至 developUse 中，命令如下：

```
touch developer1_fuc01.txt
smbclient //localhost/developUse -U developer1%123456
smb: \> put developer1_fuc01.txt
smb: \> ls
smb: \> exit
```

解释命令如下：

-  touch developer1_fuc01.txt：这个命令用于在当前目录下创建一个名为 developer1_fuc01.txt 的空文件。

 -  smbclient //localhost/developUse -U developer1%123456：这个命令使用 smbclient 工具连接到名为 developUse 的 Samba 共享目录。//localhost/developUse 是共享目录的路径，-U developer1%123456 指定了以 developer1 用户名和密码 123456 进行连接。

 -  smb: \> put developer1_fuc01.txt：这个命令在 Samba 客户端会话中将本地的 developer1_fuc01.txt 文件上传到 Samba 共享目录中。put 是 smbclient 命令的一个选项，后面跟着要上传的本地文件名。

 -  smb: \> ls：这个命令在 Samba 客户端会话中列出当前 Samba 共享目录中的文件和目录。

 -  smb: \> exit：这个命令用于退出 Samba 客户端会话。

展示结果：

![](https://i-blog.csdnimg.cn/blog_migrate/0e0e19d20abecfbe6e2cd1b427bd4b9c.png)

可以看到上传了一个文件

### 其他人员查看文件
命令如下：

```
su developer2
smbclient //localhost/developUse -U developer2%123456
smb: \> ls
smb: \> exit
```

展示结果：

![](https://i-blog.csdnimg.cn/blog_migrate/87dbd3dfcba9e196870e752e62a86db6.png)

像 tester1 和 tester2 的命令一致，查看的结果如下：

tester1 查看开发者上传的代码：

![](https://i-blog.csdnimg.cn/blog_migrate/6335b32a7493f56883c112edaaac49d7.png)

tester2 查看开发者上传的代码：

![](https://i-blog.csdnimg.cn/blog_migrate/aef412fbd945e58955e1ecd5875b343c.png)

### 其他开发者无法下载
命令如下：

```
smb: \> get developer1_fuc01.txt
```

展示如下：

![](https://i-blog.csdnimg.cn/blog_migrate/ff8683c00eeaf3422762a38ca9252bf8.png)

可以发现不能下载。

### 自动统计脚本

```
#!/bin/bash

file_path="/home/developUse"
log_file="/home/public/log/developerUserlog.txt"
current_date=$(date "+%Y-%m-%d %H:%M:%S")
count=0

for file in "$file_path"/*
do
  file_name="${file##*/}"
  IFS='_' read -r -a parts <<< "$file_name"
  developer="${parts[0]}"
  function="${parts[1]}"

  echo "developer[$count]: $developer" >> "$log_file"
  echo "function[$count]: $function" >> "$log_file"

  ((count++))
done

echo "total: $count" >> "$log_file"
echo "------$current_date------" >> "$log_file"
```

脚本的详细解释如下：

-  #!/bin/bash: 这是脚本文件的 shebang，指定了脚本的解释器为 Bash。

 -  file_path="/home/developUse": 定义了一个变量 file_path，表示文件所在的路径为 /home/developUse。

 -  log_file="/home/public/log/developerUserlog.txt": 定义了一个变量 log_file，表示日志文件的路径为 /home/public/log/developerUserlog.txt。

 -  current_date=$(date "+%Y-%m-%d %H:%M:%S"): 使用 date 命令获取当前日期和时间，并将结果赋值给变量 current_date。日期格式为 年-月-日 时：分：秒。

 -  count=0: 定义了一个变量 count，用于记录文件的数量，初始值为 0。

 -  for file in "$file_path"/*: 开始一个循环，遍历指定路径 file_path 下的所有文件。

 -  file_name="${file##*/}": 获取当前文件的文件名，${file##*/} 是一个字符串截取操作，获取最后一个 / 后面的部分，即文件名。

 -  IFS='_' read -r -a parts > "$log_file": 将开发者名称和对应的索引号记录到日志文件中。>> 是重定向操作符，将输出追加到日志文件中。

 -  echo "function[$count]: $function" >> "$log_file": 将功能名称和对应的索引号记录到日志文件中。

 -  ((count++)): 将计数器 count 的值加 1。

 -  done: 结束循环。

 -  echo "total: $count" >> "$log_file": 将文件的总数记录到日志文件中。

 -  echo "------$current_date------" >> "$log_file": 在日志文件中记录当前日期和时间，作为分隔符。

展示：

![](https://i-blog.csdnimg.cn/blog_migrate/7a0c2cf575c8c07ee23c0bfc2fb2acf8.png)

![](https://i-blog.csdnimg.cn/blog_migrate/c6fb30581387f659ad47090fb37f6d77.png)

执行自动统计脚本

```
chmod +x sum.sh
./sum.sh
```

-  `chmod +x sum.sh`： 这个命令用于修改文件的权限，`+x` 表示添加执行权限。通过执行这个命令，将为 `sum.sh` 文件添加了执行权限，使其可以在终端中运行。

 -  `./sum.sh`： 这个命令用于在当前目录下执行名为 `sum.sh` 的可执行文件。`./` 表示当前目录，`sum.sh` 是可执行文件的名称。通过执行这个命令，将运行 `sum.sh` 文件中的内容。

展示：

![](https://i-blog.csdnimg.cn/blog_migrate/c0ddac1e314ab17d00a98893efe0293d.png)

打开 log 文件夹下的相应文件

![](https://i-blog.csdnimg.cn/blog_migrate/87d418b8c27c92ea39597fda584a7ef3.png)

可以看到符合题目要求！！！

### 定时执行脚本
命令如下：

```
crontab -e
*/1 * * * * cd /home/public/code; /home/public/code/./sum.sh
0 12 * * * cd /home/public/code; /home/public/code/./sum.sh
```

命令解释：

-  `crontab -e`：这个命令用于编辑当前用户的 crontab 文件。执行该命令后，将打开一个文本编辑器，允许您添加、修改和删除计划任务。

 -  `*/1 * * * * cd /home/public/code; /home/public/code/./sum.sh`： 这个命令表示一个计划任务规则。它意味着指定的命令将每隔 1 分钟执行一次。命令本身将当前工作目录更改为`/home/public/code`，并执行位于`/home/public/code`的`sum.sh`脚本。

   `*/1` 表示每隔 1 个时间单位执行一次，这里是每隔 1 分钟。

 -  `* * * * *` 是 crontab 的时间字段，依次表示分钟、小时、日期、月份、星期几。此处使用通配符`*`，表示匹配任意值。

 -  `cd /home/public/code` 是将当前工作目录更改为`/home/public/code`。

 -  `/home/public/code/./sum.sh` 是执行`/home/public/code/sum.sh`脚本。

  -  `0 12 * * * cd /home/public/code; /home/public/code/./sum.sh`： 这个命令表示另一个计划任务规则。它意味着指定的命令将每天中午 12 点执行一次。命令本身与上述相同，将当前工作目录更改为`/home/public/code`，并执行位于`/home/public/code`的`sum.sh`脚本。

   `0 12 * * *` 表示每天中午 12 点执行。

 -  后续的部分与第一个命令相同，是更改目录和执行脚本的命令。

展示：

![](https://i-blog.csdnimg.cn/blog_migrate/4d3bc07fba6a9775293e935e2e244695.png)

验证(等待一分钟查看)：

![](https://i-blog.csdnimg.cn/blog_migrate/d49b50e4839daf874515c42c6152be1d.png)

发现定时备份成功！！！

## 功能--finished/testReport 文件夹
### 测试人员测试+测试报告
测试者完成开发者上传的测试脚本如下：

```
#!/bin/bash
if [ $# -eq 0 ]; then
    echo "Please provide the tester name as an argument."
    exit 1
fi

tester_name=$1
current_dir=$(pwd)
files_in_current_dir=(/home/developUse/*)
selected_file=""
select prompt in "${files_in_current_dir[@]}"; do
    selected_file="$prompt"
    break
done
developer_name=$(echo "$selected_file" | cut -d'_' -f1 | cut -d'/' -f4)
feature_name=$(echo "$selected_file" | cut -d'_' -f2)
new_file_name="${developer_name}_${feature_name}_finished"
mv "$selected_file" "/home/finished/$new_file_name"
character_count=$(wc -c < "/home/finished/$new_file_name")
report_file="${developer_name}_${feature_name}_${tester_name}.txt"
echo "File Name: $new_file_name" > "/home/testReport/$report_file"
echo "Character Count: $character_count" >> "/home/testReport/$report_file"
echo "Test success"
```

脚本解释如下：

这段代码是一个 Bash 脚本，用于执行一些文件操作和生成测试报告。下面是对每个部分的解释：

-  `#!/bin/bash`： 这是一个 shebang，指定了脚本要使用的解释器，这里是 Bash。

 -  `if [ $# -eq 0 ]; then ... fi`： 这是一个条件语句用于检查脚本是否有传入参数。`$#` 是一个特殊变量，表示传递给脚本的参数个数。`-eq` 是一个数值比较运算符，表示相等。所以这个条件判断的意思是，如果没有传入参数，则输出一条提示信息并退出脚本。

 -  `tester_name=$1`： 将传入的第一个参数赋值给变量 `tester_name`，即测试者的名字。

 -  `current_dir=$(pwd)`： 将当前目录的路径保存到变量 `current_dir` 中。`$(pwd)` 是一个命令替换，用于执行 `pwd` 命令并将其输出结果赋值给变量。

 -  `files_in_current_dir=(/home/developUse/*)`： 定义一个数组 `files_in_current_dir`，包含 `/home/developUse/` 目录下的所有文件。`/home/developUse/*` 是通配符，用于匹配该目录下的所有文件。

 -  `selected_file=""`： 初始化一个空字符串变量 `selected_file`，用于保存用户选择的文件。

 -  `select prompt in "${files_in_current_dir[@]}"; do ... done`： 这是一个菜单选择语句，用于让用户从 `files_in_current_dir` 数组中选择一个文件。`select` 关键字会生成一个菜单，`prompt` 是菜单的提示信息。`"${files_in_current_dir[@]}"` 会展开数组中的所有元素作为菜单选项。`do ... done` 之间的代码会在用户选择一个选项后执行。

 -  `selected_file="$prompt"`： 将用户选择的选项保存到 `selected_file` 变量中。

 -  `developer_name=$(echo "$selected_file" | cut -d'_' -f1 | cut -d'/' -f4)`： 这一行使用了管道和 `cut` 命令来提取开发者的名字。首先，`echo "$selected_file"` 将 `selected_file` 的值输出。然后，第一个 `cut` 命令使用 `-d'_'` 选项指定了分隔符为下划线，`-f1` 选项表示提取第一个字段，即开发者的名字。接着，管道将输出传递给第二个 `cut` 命令，该命令使用 `-d'/'` 选项指定了分隔符为斜杠，`-f4` 选项表示提取第四个字段，即开发者名字所在的目录。

 -  `feature_name=$(echo "$selected_file" | cut -d'_' -f2)`： 这一行使用了类似的方法提取特性名字，将第二个字段提取出来。

 -  `new_file_name="${developer_name}_${feature_name}_finished"`： 构造一个新的文件名，格式为 `开发者名字_特性名字_finished`。

 -  `mv "$selected_file" "/home/finished/$new_file_name"`： 将选中的文件移动到 `/home/finished/` 目录下，并将其重命名为 `new_file_name`。

 -  `character_count=$(wc -c < "/home/finished/$new_file_name")`： 使用 `wc` 命令统计 `/home/finished/$new_file_name` 文件的字符数，并将结果赋值给变量 `character_count`。`wc -c` 表示只统计字符数，`<` 表示将文件作为输入。

 -  `report_file="${developer_name}_${feature_name}_${tester_name}.txt"`： 构造一个报告文件名，格式为 `开发者名字_特性名字_测试者名字.txt`。

 -  `echo "File Name: $new_file_name" > "/home/testReport/$report_file"`： 将 "File Name: $new_file_name" 的内容写入 `/home/testReport/$report_file` 文件中。`>` 是重定向符号，用于将输出重定向到文件中。如果文件不存在，则创建新文件；如果文件已存在，则覆盖原有内容。

 -  `echo "Character Count: $character_count" >> "/home/testReport/$report_file"`： 将 "Character Count: $character_count" 的内容追加写入 `/home/testReport/$report_file` 文件中。`>>` 是追加重定向符号，用于将输出追加到文件末尾。

 -  `echo "Test success"`： 输出字符串 "Test success"。

展示：

![](https://i-blog.csdnimg.cn/blog_migrate/75b58b84e3eeaf24e5ddef83e120f6ed.png)

![](https://i-blog.csdnimg.cn/blog_migrate/8b82a9f130a1f0770c79ad3a008cf236.png)

同时，还要给脚本一定的权限；

```
chmod +x /home/public/code/testCode.sh
```

赋予 testers 组进行测试的权力，`visudo` 的填写如下：

![](https://i-blog.csdnimg.cn/blog_migrate/18e82a53d27255196e467824f200f6f0.png)

测试员测试代码的命令如下：

```
sudo /home/public/code/./testCode.sh tester1
```

操作如下：

![](https://i-blog.csdnimg.cn/blog_migrate/1744e5ad981ed0193a611c1ca4244fab.png)

验证如下：

![](https://i-blog.csdnimg.cn/blog_migrate/ff95ea312c1be5d8be5b5dde7de89363.png)

生成了完整的报告！！！

### 统计测试报告
脚本如下：

```
#!/bin/bash

filePath="/home/testReport"
fileName="sumTest$(date)"
OIFS=$IFS
IFS='_'
a=0

for file in "${filePath}"/*; do
    file=${file##*/}
    read -ra parts <<< "$file"
    echo "tester[$a]: ${parts[2]}" >> "/home/public/log/sumTestLog.txt"
    echo "developer[$a]: ${parts[0]}" >> "/home/public/log/sumTestLog.txt"
    echo "function[$a]: ${parts[1]}" >> "/home/public/log/sumTestLog.txt"

    # testTime
    modification_time=$(stat -c %Y "/home/testReport/$file")
    formatted_time=$(date -d @"$modification_time" +"%Y-%m-%d %H:%M:%S")
    echo "testTime[$a]: ${formatted_time}" >> "/home/public/log/sumTestLog.txt"

    a=$((a + 1))
done

echo "------$(date "+%Y-%m-%d %H:%M:%S")------" >> "/home/public/log/sumTestLog.txt"
```

脚本命令解释如下：

这是一个 Bash 脚本，用于处理位于指定路径(`/home/testReport`)下的文件，并将结果写入日志文件(`/home/public/log/sumTestLog.txt`)。

下面是脚本的详细解释：

-  `#!/bin/bash`： 这是 Bash 脚本的开头，指定了脚本使用的解释器。

 -  `filePath="/home/testReport"`： 设置变量 `filePath` 的值为 `/home/testReport`，表示待处理文件所在的路径。

 -  `fileName="sumTest$(date)"`： 设置变量 `fileName` 的值为 `sumTest` 加上当前日期和时间。`$(date)` 表示执行 `date` 命令并将结果插入到变量中。

 -  `OIFS=$IFS` 和 `IFS='_'`： 这两行用于保存原始的分隔符设置并将分隔符设置为下划线 `_`。`OIFS` 变量存储了原始的分隔符设置，`IFS` 变量用于设置新的分隔符。

 -  `a=0`： 初始化变量 `a` 的值为 0，用于计数。

 -  `for file in "${filePath}"/*; do`： 这是一个循环语句，遍历指定路径下的所有文件。

 -  `file=${file##*/}`： 从完整的文件路径中提取出文件名，将结果存储在变量 `file` 中。

 -  `read -ra parts <<< "$file"`： 将文件名按照分隔符 `_` 进行拆分，将拆分结果存储在数组 `parts` 中。

 -  `echo "tester[$a]: ${parts[2]}" >> "/home/public/log/sumTestLog.txt"`： 将数组 `parts` 中第 2 个元素的值写入日志文件。

 -  `echo "developer[$a]: ${parts[0]}" >> "/home/public/log/sumTestLog.txt"`： 将数组 `parts` 中第 0 个元素的值写入日志文件。

 -  `echo "function[$a]: ${parts[1]}" >> "/home/public/log/sumTestLog.txt"`： 将数组 `parts` 中第 1 个元素的值写入日志文件。

 -  `modification_time=$(stat -c %Y "/home/testReport/$file")`： 使用 `stat` 命令获取文件的修改时间，并将结果存储在变量 `modification_time` 中。

 -  `formatted_time=$(date -d @"$modification_time" +"%Y-%m-%d %H:%M:%S")`： 使用 `date` 命令将 `modification_time` 转换为特定格式的时间字符串，并将结果存储在变量 `formatted_time` 中。

 -  `echo "testTime[$a]: ${formatted_time}" >> "/home/public/log/sumTestLog.txt"`： 将变量 `formatted_time` 的值写入日志文件。

 -  `a=$((a + 1))`： 将变量 `a` 的值加 1，用于计数器的增加。

 -  `echo "------$(date "+%Y-%m-%d %H:%M:%S")------" >> "/home/public/log/sumTestLog.txt"`： 在日志文件中插入当前日期和时间的分隔符。

总体来说，该脚本的功能是遍历指定路径下的文件，从文件名中提取出特定信息，然后将这些信息写入日志文件。

![](https://i-blog.csdnimg.cn/blog_migrate/101ca324eeef1361992010a73d80ae18.png)

![](https://i-blog.csdnimg.cn/blog_migrate/3c3d708b66db4bfcf9bb3aea4e096ee8.png)

测试脚本：

![](https://i-blog.csdnimg.cn/blog_migrate/365955833b2b928bab58a010fcc2fd57.png)

可以看到，脚本生效，完美实现！

## 问题与解决办法
问题描述：使用 vi 命令进入文件后，发现键盘的上下左右是 wsad

解决办法：参考[【解决】ubuntu 用 vim 编辑时退格键和上下左右键失灵的问题_ubuntu 编辑时删除键-CSDN 博客](https://blog.csdn.net/qq_29750461/article/details/128347431?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522170312139616800226569356%2522%252C%2522scm%2522%253A%252220140713.130102334..%2522%257D&request_id=170312139616800226569356&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~sobaiduend~default-1-128347431-null-null.142%5Ev96%5Epc_search_result_base7&utm_term=ubuntu18.04%E7%9A%84vim%E4%B8%8A%E4%B8%8B%E5%B7%A6%E5%8F%B3&spm=1018.2226.3001.4187)

问题描述：在桌面进入终端，进入的是用户，没有办法进入 root，即使 su -，也不行。

解决办法：参考[【解决】ubuntu 用 vim 编辑时退格键和上下左右键失灵的问题_ubuntu 编辑时删除键-CSDN 博客](https://blog.csdn.net/qq_29750461/article/details/128347431?ops_request_misc=%257B%2522request%255Fid%2522%253A%2522170312139616800226569356%2522%252C%2522scm%2522%253A%252220140713.130102334..%2522%257D&request_id=170312139616800226569356&biz_id=0&utm_medium=distribute.pc_search_result.none-task-blog-2~all~sobaiduend~default-1-128347431-null-null.142%5Ev96%5Epc_search_result_base7&utm_term=ubuntu18.04%E7%9A%84vim%E4%B8%8A%E4%B8%8B%E5%B7%A6%E5%8F%B3&spm=1018.2226.3001.4187)

问题描述：有时候使用 apt-get 命令无法下载，如果看英文的话可以知道是连接不上服务器。

解决办法：修改一下镜像源。

问题描述：testCode.sh 脚本初始版本如下：

```
#!/bin/bash
tester_name=$(who | awk '{print $1}')
current_dir=$(pwd)
files_in_current_dir=(/home/developUse/*)
selected_file=""
select prompt in "${files_in_current_dir[@]}"; do
    selected_file="$prompt"
    break
done
developer_name=$(echo "$selected_file" | cut -d'_' -f1 | cut -d'/' -f4)
feature_name=$(echo "$selected_file" | cut -d'_' -f2)
new_file_name="${developer_name}_${feature_name}_finished"
mv "$selected_file" "/home/finished/$new_file_name"
character_count=$(wc -c < "/home/finished/$new_file_name")
report_file="${developer_name}_${feature_name}_${tester_name}.txt"
echo "File Name: $new_file_name" > "/home/testReport/$report_file"
echo "Character Count: $character_count" >> "/home/testReport/$report
```

其实，基本功能差不多，但是后面出现的另一个问题导致该脚本出现了问题。

另一个问题就是：testers 没有权限移动删除 developUse 里面的文件，解决办法也简单，通过 visudo 编辑即可，但是导致 `tester_name=$(who | awk '{print $1}')` 获取到的永远都是 root 用户名，没办法，做了如下改变

```
if [ $# -eq 0 ]; then
    echo "Please provide the tester name as an argument."
    exit 1
fi
```

问题描述：太多问题了，中间太多 bug 了，写不过了

解决办法：耐心，细心以及热爱和感谢所有帮助过我的同学！

## 后记
(约等于实验心得)

本次实验实在是道阻且长，前前后后不知道花费了多少时间去学习，一开始把前面几次的实验重新学习做了一遍，后面发现 red hat 的虚拟机好像不太好用，又开始学习 VMware 虚拟机的配置，准备工作才完成。后面的工作又是慢慢摸索，总是碰壁。好在有 **夏hl** 同学的帮助，非常感谢夏同学的帮助，不然不可能准时完成本次实验。

该实验真的是收获满满。首先是 Linux 的常见操作我已经烂熟于心了，其次我也深刻理解了操作系统中的进程管理，文件管理和网络服务，真的是深刻了解了。

##
