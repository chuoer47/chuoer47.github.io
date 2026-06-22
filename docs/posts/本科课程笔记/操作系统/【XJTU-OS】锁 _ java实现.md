---
title: "【XJTU-OS】锁 | java实现"
date: 2025-04-20 :25
tags:
- 操作系统
category: 本科课程笔记
order: 46
---

# 【XJTU-OS】锁 | java实现

[进程同步互斥习题解析-CSDN博客](https://yijunquan.blog.csdn.net/article/details/122078799)

习题来自上述链接

为了更好的展示，使用java完成了进程同步，锁互斥。

大家可以java跑一下小程序，看看效果，加深理解。

题目一：汽车行驶
```
import java.util.concurrent.Semaphore;

public class VehicleMovement {
    public static final Semaphore s = new Semaphore(1); // 每一个十字路口(东西，南北)，只允许一个道路行驶

    public static void main(String[] args) throws InterruptedException {
        // 创建从东向西的线程
        Thread eastToWest = new Thread(() -> {
            while (true) {
                try {
                    s.acquire();
                    System.out.println("东西方向的车正在行驶");
                    Thread.sleep(2000);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                } finally {
                    s.release();
                    System.out.println("东西方向的车行驶完毕");
                }
            }
        });

        Thread southToNorth = new Thread(() -> {
            while (true) {
                try {
                    s.acquire();
                    System.out.println("南北方向的车正在行驶");
                    Thread.sleep(2000);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                } finally {
                    s.release();
                    System.out.println("南北方向的车行驶完毕");
                }
            }
        });
        eastToWest.setDaemon(true);
        southToNorth.setDaemon(true);
        eastToWest.start();
        southToNorth.start();
        Thread.sleep(10000);
    }
}

```

题目二：取材料问题
```
import java.util.concurrent.Semaphore;

public class MaterialAccess {
    public static final Semaphore box = new Semaphore(1);
    public static final Semaphore pen = new Semaphore(0);
    public static final Semaphore paper = new Semaphore(0);

    public static void main(String[] args) throws InterruptedException {
        Thread keeper = new Thread(() -> {
            while (true) {
                try {
                    box.acquire();
                    pen.release();
                    paper.release();
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                } finally {
                    box.release();
                    System.out.println("保管员操作完毕");
                }
            }
        });

        Thread groupA = new Thread(() -> {
            while (true) {
                try {
                    pen.acquire();
                    box.acquire();
                    System.out.println("A组取笔");
                    Thread.sleep(100);

                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                } finally {
                    box.release();

                }
            }
        });

        Thread groupB = new Thread(() -> {
            while (true) {
                try {
                    paper.acquire();
                    box.acquire();

                    System.out.println("B组取纸");
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                } finally {
                    box.release();

                }
            }
        });

        keeper.setDaemon(true);
        groupA.setDaemon(true);
        groupB.setDaemon(true);
        keeper.start();
        groupA.start();
        groupB.start();

        Thread.sleep(1000);
    }
}

```

题目三：小桥过人问题
```
import java.util.Random;
import java.util.concurrent.Semaphore;

public class BridgeCrossing {
    // 初始化信号量
    private static final Semaphore EW = new Semaphore(2);
    private static final Semaphore WE = new Semaphore(2);
    private static final Semaphore stayInEast = new Semaphore(1);
    private static final Semaphore stayInWest = new Semaphore(1);

    public static void main(String[] args) {
        int numThreads = 5; // 模拟行人数量
        for (int i = 0; i < numThreads; i++) {
            boolean isEastToWest = Math.random() > 0.5;
            Thread thread;
            if (isEastToWest) {
                thread = new Thread(new EastToWestRunnable());
                System.out.println(thread.getName() + "准备从东到西");
            } else {
                thread = new Thread(new WestToEastRunnable());
                System.out.println(thread.getName() + "准备从西到东");
            }
            // 设置为守护线程
            thread.setDaemon(true);
            thread.start();
        }

        try {
            // 主线程等待一段时间，防止程序立即退出，以便观察守护线程的运行情况
            Thread.sleep(10000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    static class EastToWestRunnable implements Runnable {
        @Override
        public void run() {
            try {
                // P(EW) 操作，申请资源
                EW.acquire();
                // P(WE) 操作，申请资源
                WE.acquire();
                // P(east) 操作，申请资源
                stayInEast.acquire();
                System.out.println(Thread.currentThread().getName() + " 从东岸经东段桥，走到桥中央");
                // 模拟行走时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // V(east) 操作，释放资源
                stayInEast.release();
                System.out.println(Thread.currentThread().getName() + " 通过桥中央或者休息");
                // 模拟停留时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // P(west) 操作，申请资源
                stayInWest.acquire();
                System.out.println(Thread.currentThread().getName() + " 经西段桥，从桥中央到西岸");
                // 模拟行走时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // V(west) 操作，释放资源
                stayInWest.release();
                // V(WE) 操作，释放资源
                WE.release();
                // V(EW) 操作，释放资源
                EW.release();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    static class WestToEastRunnable implements Runnable {
        @Override
        public void run() {
            try {
                // P(EW) 操作，申请资源
                EW.acquire();
                // P(WE) 操作，申请资源
                WE.acquire();
                // P(west) 操作，申请资源
                stayInWest.acquire();
                System.out.println(Thread.currentThread().getName() + " 从西岸经西段桥，走到桥中央");
                // 模拟行走时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // V(west) 操作，释放资源
                stayInWest.release();
                System.out.println(Thread.currentThread().getName() + " 通过桥中央或者休息");
                // 模拟停留时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // P(east) 操作，申请资源
                stayInEast.acquire();
                System.out.println(Thread.currentThread().getName() + " 经东段桥，从桥中央到东岸");
                // 模拟行走时间
                Thread.sleep(new Random().nextLong(0, 1000));
                // V(east) 操作，释放资源
                stayInEast.release();
                // V(WE) 操作，释放资源
                WE.release();
                // V(EW) 操作，释放资源
                EW.release();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
```

题目四：阅览室登记问题
```
import java.util.HashSet;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.Semaphore;

public class ReadRoomRegistration {
    public static final Semaphore register = new Semaphore(1);
    public static final Semaphore seat = new Semaphore(3);
    public static Set`String` registerSet = new HashSet`String`();

    public static void main(String[] args) {
        for (int i = 0; i < 10; i++) {
            Thread t = new Thread(new Reader());
            t.start();
        }

    }

    static class Reader implements Runnable {
        @Override
        public void run() {
            try {
                seat.acquire();

                register.acquire();
                System.out.println(Thread.currentThread().getName() + "登记名字;登记表为" + registerSet.toString());
                registerSet.add(Thread.currentThread().getName());
                register.release();

                long readTime = new Random().nextLong(1000);
                System.out.println(Thread.currentThread().getName() + "要读书时间为：" + Long.toString(readTime) + "ms");
                Thread.sleep(readTime);

                register.acquire();
                registerSet.remove(Thread.currentThread().getName());
                System.out.println(Thread.currentThread().getName() + "划去名字;登记表为" + registerSet.toString());
                register.release();

                seat.release();
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }

    }
}

```
题目五：流水线问题
```
import java.util.Random;
import java.util.concurrent.Semaphore;

public class StreamLine {
    public static final Semaphore lock1 = new Semaphore(1);
    public static final Semaphore lock2 = new Semaphore(0);
    public static final Semaphore lock3 = new Semaphore(0);
    public static final Semaphore lock4 = new Semaphore(0);
    public static final Semaphore lock5 = new Semaphore(1);

    public static void main(String[] args) {

        new Thread(()->{
            try {
                lock1.acquire();
                long time = new Random().nextLong(1000);
                System.out.println("工厂1要运行时间：" + Long.toString(time) + "ms");
                Thread.sleep(time);
                System.out.println("工厂1运行完毕");

                lock2.release();
                lock3.release();

            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }).start();

        new Thread(() -> {
            try {
                lock2.acquire();
                long time = new Random().nextLong(1000);
                System.out.println("工厂2要运行时间：" + Long.toString(time) + "ms");
                Thread.sleep(time);
                System.out.println("工厂2运行完毕");
                lock4.release();
                lock2.release();
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }).start();

        new Thread(() -> {
            try {
                lock3.acquire();
                long time = new Random().nextLong(1000);
                System.out.println("工厂3要运行时间：" + Long.toString(time) + "ms");
                Thread.sleep(time);
                System.out.println("工厂3运行完毕");

                lock5.release();
                lock3.release();
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }).start();

        new Thread(() -> {
            try {
                lock4.acquire();
                lock5.acquire();
                long time = new Random().nextLong(1000);
                System.out.println("工厂4要运行时间：" + Long.toString(time) + "ms");
                Thread.sleep(time);
                System.out.println("工厂4运行完毕");

            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }).start();

    }
}

```

题目七：理发师问题
```
import java.util.Date;
import java.util.Random;
import java.util.concurrent.Semaphore;
/*
稍微改变了一下逻辑
可以更好的展示；
顾客如果位置满了，就先走，但是过会再来一趟。
直到有空位，占空位，然后等理发师。

同时改变了逻辑，设置有x个理发师，y个顾客
 */

public class SleepingBarber {
    public static final Integer baber = 2;
    public static final Integer customer = 10;
    public static final Semaphore chairLock = new Semaphore(1);
    public static final Semaphore barberReady = new Semaphore(baber); // barberReady保证了顾客的顺序性；barberReady可以视作理发位置的锁；
    public static final Semaphore waitCustomer = new Semaphore(0);
    public static Integer chair = 3 + 2;

    public static void main(String[] args) throws InterruptedException {
        for (int i = 0; i < baber; i++) {
            Thread baber = new Thread(new Barber());
            baber.setDaemon(true);
            baber.start();
        }

        for (int i = 0; i < customer; i++) {
            Thread customer = new Thread(new Customer());
            long time = new Random().nextLong(100);
            Thread.sleep(time);
            customer.setDaemon(true);
            customer.start();
        }

        Thread.sleep(30000);
    }

    static class Barber implements Runnable {

        @Override
        public void run() {
            while (true) {
                try {
                    waitCustomer.acquire(); // 没得到就在睡觉，得到就起来干活
                    long time = new Random().nextLong(1000, 5000);
                    System.out.println(new Date().toString() + " " + Thread.currentThread().getName() + "理发时间为：" + Long.toString(time) + "ms");
                    Thread.sleep(time);
                    chairLock.acquire();
                    chair -= 1;
                    chairLock.release();
                    barberReady.release();
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
            }
        }
    }

    static class Customer implements Runnable {
        @Override
        public void run() {
            try {
                while (true) {
                    chairLock.acquire();
                    if (chair == 0) {
                        chairLock.release();
                    } else {
                        chair -= 1;
                        chairLock.release();
                        waitCustomer.release();
                        barberReady.acquire();
                        break;
                    }
                }
            } catch (InterruptedException e) {
                throw new RuntimeException(e);
            }
        }
    }

}

```
