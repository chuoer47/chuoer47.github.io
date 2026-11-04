<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, useId } from "vue";
import { useData } from "vitepress";

const props = defineProps<{ source: string }>();
const { isDark } = useData();
const container = ref<HTMLElement>();
const error = ref("");
const diagramId = useId().replace(/:/g, "-");
let revision = 0;

async function render() {
  const current = ++revision;
  try {
    const { default: mermaid } = await import("mermaid");
    if (current !== revision || !container.value) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark.value ? "dark" : "default" });
    const id = `mermaid-${diagramId}-${current}`;
    const { svg, bindFunctions } = await mermaid.render(id, decodeURIComponent(props.source));
    if (current !== revision || !container.value) return;
    container.value.innerHTML = svg;
    bindFunctions?.(container.value);
    error.value = "";
  } catch (cause) {
    if (current !== revision) return;
    error.value = "图表渲染失败，请展开查看源码。";
    console.error("Mermaid render failed", cause);
  }
}

onMounted(() => {
  void render();
  watch([() => props.source, isDark], render);
});
onBeforeUnmount(() => { revision++; });
</script>

<template>
  <figure class="mermaid-diagram" aria-label="Mermaid 图表">
    <div ref="container" />
    <p v-if="error" role="alert">{{ error }}</p>
    <details>
      <summary>图表源码</summary>
      <pre>{{ decodeURIComponent(source) }}</pre>
    </details>
  </figure>
</template>

<style scoped>
.mermaid-diagram { margin: 1.5rem 0; overflow-x: auto; }
.mermaid-diagram :deep(svg) { max-width: 100%; height: auto; margin: auto; }
summary { cursor: pointer; color: var(--vp-c-text-2); font-size: 0.85rem; }
pre { white-space: pre-wrap; }
</style>
