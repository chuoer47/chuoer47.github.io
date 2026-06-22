---
title: "IDEA-类图插件"
date: 2023-12-21 :54
tags:
- 其他
category: 本科课程笔记
order: 8
---

# IDEA-类图插件

最近学习设计模式，发现有一个插件可以直接生成UML，非常好用。

下面记录一下。

插件为：

![](https://i-blog.csdnimg.cn/blog_migrate/60664a89d32664f3066151881d258763.png)

插件具体安装过程不再赘述。

下面讲讲我惊喜的点：

比如生成工厂模式的类图

![](https://i-blog.csdnimg.cn/blog_migrate/54c8cdde614517e0e6774b83a69e61ac.png)

可以很快地筛选想看的，比如构造函数，属性，方法等等等，以及依赖和其他关系判断自己构造的模式是否符合原设计。感觉还是非常好的。

下面给一下代码：

`public class Main {
    public static void main(String[] args) {
        Shape shape;
        int[] kind = {Const.SQUARE, Const.RECTANGLE, Const.CIRCLE};
        for (int i : kind) {
            shape = ShapeFactory.getShape(i);
            shape.draw();
        }
    }
}`

`public class Const {
    protected static final int CIRCLE = 938;
    protected static final int RECTANGLE = 953;
    protected static final int SQUARE = 706;
}
`

`public interface Shape {
    public void draw();
}
`

`public class Circle implements Shape {
    @Override
    public void draw() {
        System.out.println("it is a circle.");
    }
}
`

`public class Rectangle implements Shape {
    @Override
    public void draw() {
        System.out.println("it is a rectangle");
    }
}
`

`public class Square implements Shape {
    @Override
    public void draw() {
        System.out.println("it is a square.");
    }
}
`

`public class ShapeFactory {
    public static Shape getShape(int SHAPE) {
        Shape shape;
        if (SHAPE == Const.CIRCLE) {
            shape = new Circle();
        } else if (SHAPE == Const.RECTANGLE) {
            shape = new Rectangle();
        } else if (SHAPE == Const.SQUARE) {
            shape = new Square();
        } else {
            shape = null;
        }
        return shape;
    }
}
`
