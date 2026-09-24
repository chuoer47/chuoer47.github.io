<script setup>
import { onMounted, ref } from "vue";
import { useSidebar } from "vitepress/theme";

const { hasSidebar } = useSidebar();
const hidden = ref(false);

function apply() {
  document.documentElement.classList.toggle("sidebar-hidden", hidden.value);
}

onMounted(() => {
  hidden.value = localStorage.getItem("chuoer-sidebar-hidden") === "1";
  apply();
});

function toggle() {
  hidden.value = !hidden.value;
  localStorage.setItem("chuoer-sidebar-hidden", hidden.value ? "1" : "0");
  apply();
}
</script>

<template>
  <button
    v-if="hasSidebar"
    class="sidebar-collapse-toggle"
    :class="{ 'is-sidebar-hidden': hidden }"
    :title="hidden ? '展开侧边栏' : '收起侧边栏'"
    :aria-label="hidden ? '展开侧边栏' : '收起侧边栏'"
    @click="toggle"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  </button>
</template>
