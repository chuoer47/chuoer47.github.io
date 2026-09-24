import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import SidebarToggle from "./SidebarToggle.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-top": () => h(SidebarToggle),
    });
  },
};
