---
title: "FLASK-转化为exe"
date: 2024-05-06 :57
tags:
- 其他
category: 本科课程笔记
order: 6
---

# FLASK-转化为exe

本篇质量较低，个人备忘录

## 前言
写好了的FLASK项目需要打包成exe，保证没有python环境的电脑也能进行展示网页。

## 方法
主要是参考了一下blog和帖子：

[使用pyinstaller将python项目打包发布为exe可执行文件 - 知乎 (zhihu.com)](https://zhuanlan.zhihu.com/p/372216711)

[Flask 将Flask Web应用程序转换为独立可执行的桌面应用程序|极客教程 (geek-docs.com)](https://geek-docs.com/flask/flask-questions/643_flask_converting_flask_web_app_to_a_standalone_executable_desktop_app.html)

[使用PyInstaller将flask打包为一个exe - 简书 (jianshu.com)](https://www.jianshu.com/p/55ff73b602c5)

## 遇到的困难 & 解决办法
在添加文件的时候要注意相对位置，添加的是文件还是文件夹

如static是文件夹，db是文件

```
datas=[
        ('appdir\\static', 'appdir\\static'),
        ('appdir\\templates', 'appdir\\templates'),
        ('appdir\\app.db', 'appdir')
    ],
```

 就这我调试了半小时
