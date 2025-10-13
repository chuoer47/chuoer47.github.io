import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "基础知识",
    icon: "/img/computer.svg",
    prefix: "posts/基础知识/",
    children: [
      {
        text: "操作系统",
        icon: "/img/操作系统.svg",
        link: "操作系统/"
      },
      {
        text: "计算机网络",
        icon: "/img/网络计算机.svg",
        link: "计算机网络/"
      },
      {
        text: "数据结构",
        icon: "/img/数据结构.svg",
        link: "数据结构/"
      },
      {
        text: "算法",
        icon: "/img/算法.svg",
        link: "算法/"
      }
    ]
  },
  {
    text: "后端",
    icon: "/img/spring.svg",
    prefix: "/posts/后端/",
    children: [
      {
        text: "Java基础",
        icon: "/img/java.svg",
        link: "Java/"
      },
      {
        text: "数据库",
        icon: "/img/数据库.svg",
        link: "数据库/"
      },
      {
        text: "后端",
        icon: "/img/SPRINGBOOT.svg",
        link: "springboot/"
      },
      {
        text: "微服务",
        icon: "/img/SpringCloud.svg",
        link: "springcloud/"
      },
    ]
  },
  
  {
    text: "工具",
    icon: "/img/tool.svg",
    prefix: "/posts/工具",
    children: [
      {
        text: "Git",
        icon: "/img/git.svg",
        link: "Git"
      },
      {
        text: "Docker",
        icon: "/img/docker.svg",
        link: "Docker"
      }
    
    ]
  },
  {
    text: "项目",
    icon: "/img/项目.svg",
    link: "/posts/项目/",
    prefix: "/posts/项目/",
    children: [
      {
        text: "苍穹外卖",
        icon: "/img/外卖.svg",
        link: "skytakeout/"
      },
      {
        text: "黑马商城",
        icon: "/img/商城.svg",
        link: "hmall/"
      },
    ]
    
  }


]);
