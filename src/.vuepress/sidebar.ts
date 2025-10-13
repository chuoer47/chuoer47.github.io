import { sidebar } from "vuepress-theme-hope";

export default sidebar({
  "/posts/工具/": [
    {
      text: "Git",
      icon: "/img/git.svg",
      link: "Git"
    },
    {
      text: "Docker",
      icon: "/img/docker.svg",
      link: "Docker"
    },
    {
      text: "RabbitMq",
      icon: "/img/docker.svg",
      prefix: "RabbitMq",
      children: "structure"
    }
    
  ],
  "/posts/后端/": [
    {
      text: "Java基础",
      icon: "/img/java.svg",
      prefix: "Java",
      children: "structure"
    },
    {
      text: "数据库",
      icon: "/img/数据库.svg",
      prefix: "数据库",
      children: "structure"
    },
     {
      text: "后端",
      icon: "/img/SPRINGBOOT.svg",
      prefix: "springboot",
      children: "structure"
    }, {
      text: "微服务",
      icon: "/img/SpringCloud.svg",
      prefix: "springcloud",
      children: "structure"
    },
  ],
  "/posts/基础知识/": [
    {
      text: "操作系统",
      icon: "/img/操作系统.svg",
      prefix: "操作系统",
      children: "structure"
    },
    {
      text: "计算机网络",
      icon: "/img/网络计算机.svg",
      prefix: "计算机网络",
      children: "structure"
    },
    {
      text: "数据结构",
      icon: "/img/数据结构.svg",
      prefix: "数据结构/",
      children: "structure"
    },
    {
      text: "算法",
      icon: "/img/算法.svg",
      prefix: "算法",
      children: "structure"
    }
  ],
  "/posts/项目/": [
    {
      text: "项目",
      icon: "/img/项目.svg",
      link: "/posts/项目/"
    },
    {
      text: "苍穹外卖",
      icon: "/img/外卖.svg",
      prefix: "skytakeout",
      children: "structure"
    },
    {
      text: "黑马商城",
      icon: "/img/商城.svg",
      prefix: "hmall",
      children: "structure"
    },
    {
      text: "黑马头条",
      icon: "/img/头条.svg",
      prefix: "heimaLeadnews",
      children: "structure"
    },
    {
      text: "学成在线",
      icon: "/img/教育.svg",
      prefix: "studyOnline",
      children: "structure"
    },
    {
      text: "短链接系统",
      icon: "/img/link.svg",
      prefix: "shortService",
      children: "structure"
    }
  ],

});
