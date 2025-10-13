import { defineClientConfig } from "vuepress/client";
import { hasGlobalComponent } from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/@vuepress+helper@2.0.0-rc.2_268ba505409bc79f60d8ed1170c30017/node_modules/@vuepress/helper/lib/client/index.js";

import { useScriptTag } from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/@vueuse+core@10.9.0_vue@3.4.27/node_modules/@vueuse/core/index.mjs";
import FontIcon from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-components@_23f30bdfd1c26740c5b83004f9621084/node_modules/vuepress-plugin-components/lib/client/components/FontIcon.js";
import Badge from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-components@_23f30bdfd1c26740c5b83004f9621084/node_modules/vuepress-plugin-components/lib/client/components/Badge.js";
import VPCard from "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-components@_23f30bdfd1c26740c5b83004f9621084/node_modules/vuepress-plugin-components/lib/client/components/VPCard.js";

import "F:/code_lib/BlogWeb/chuoer47.github.io/node_modules/.pnpm/vuepress-plugin-components@_23f30bdfd1c26740c5b83004f9621084/node_modules/vuepress-plugin-components/lib/client/styles/sr-only.scss";

export default defineClientConfig({
  enhance: ({ app }) => {
    if(!hasGlobalComponent("FontIcon")) app.component("FontIcon", FontIcon);
    if(!hasGlobalComponent("Badge")) app.component("Badge", Badge);
    if(!hasGlobalComponent("VPCard")) app.component("VPCard", VPCard);
    
  },
  setup: () => {
    useScriptTag(
  `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/js/brands.min.js`,
  () => {},
  { attrs: { "data-auto-replace-svg": "nest" } }
);

    useScriptTag(
  `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/js/solid.min.js`,
  () => {},
  { attrs: { "data-auto-replace-svg": "nest" } }
);

    useScriptTag(
  `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/js/fontawesome.min.js`,
  () => {},
  { attrs: { "data-auto-replace-svg": "nest" } }
);

  },
  rootComponents: [

  ],
});
