import {defineClientConfig} from "vuepress/client"
import {setupRunningTimeFooter} from "vuepress-theme-hope/presets/footerRunningTime.js"
import {setupTransparentNavbar} from "vuepress-theme-hope/presets/transparentNavbar.js"
import "vuepress-theme-hope/presets/round-blogger-avatar.scss";
import "vuepress-theme-hope/presets/shinning-feature-panel.scss";
import "vuepress-theme-hope/presets/bounce-icon.scss";


export default defineClientConfig({
    setup:() => {
        setupRunningTimeFooter(
          new Date("2025-08-06"),
          {
            "/":  "本站已运行 :day 天 :hour 小时 :minute 分钟 :second 秒",
          },
          true,
        );
        setupTransparentNavbar({ type: "homepage" });
      },

})