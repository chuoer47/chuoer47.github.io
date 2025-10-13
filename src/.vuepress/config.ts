import { defineUserConfig } from "vuepress";
import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  lang: "zh-CN",
  title: "chuoer47",
  description: "vuepress-theme-hope 的博客演示",
  head: [
    // 设置 favor.ico，.vuepress/public 下
    [
        'link', { rel: 'icon', href: '/logo.png' }
    ]
],

  theme,

  // 和 PWA 一起启用
  // shouldPrefetch: false,
});
