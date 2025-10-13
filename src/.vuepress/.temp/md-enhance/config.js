import { defineClientConfig } from "vuepress/client";
import CodeTabs from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/components/CodeTabs.js";
import { hasGlobalComponent } from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/@vuepress+helper@2.0.0-rc.2_268ba505409bc79f60d8ed1170c30017/node_modules/@vuepress/helper/lib/client/index.js";
import { CodeGroup, CodeGroupItem } from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/compact/index.js";
import CodeDemo from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/components/CodeDemo.js";
import MdDemo from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/components/MdDemo.js";
import "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/styles/figure.scss";
import { useHintContainers } from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/composables/useHintContainers.js";
import "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/styles/hint/index.scss";
import "./mathjax.css";
import Tabs from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/components/Tabs.js";
import "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/@mdit+plugin-spoiler@0.10.1_markdown-it@14.1.0/node_modules/@mdit/plugin-spoiler/spoiler.css";
import "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-md-enhance@_3b66e9c443f5f3703c0aaa3528c77cab/node_modules/vuepress-plugin-md-enhance/lib/client/styles/tasklist.scss";

export default defineClientConfig({
  enhance: ({ app }) => {
    app.component("CodeTabs", CodeTabs);
    if(!hasGlobalComponent("CodeGroup", app)) app.component("CodeGroup", CodeGroup);
    if(!hasGlobalComponent("CodeGroupItem", app)) app.component("CodeGroupItem", CodeGroupItem);
    app.component("CodeDemo", CodeDemo);
    app.component("MdDemo", MdDemo);
    app.component("Tabs", Tabs);
  },
  setup: () => {
useHintContainers();
  }
});
