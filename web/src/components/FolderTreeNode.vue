<template>
  <div class="tree-node-wrapper">
    <div 
      class="tree-node-item"
      :class="{ active: currentPath === node.path }"
      :style="{ paddingLeft: (node.level * 14 + 10) + 'px' }"
      @click="$emit('select-node', node)"
    >
      <span 
        class="node-arrow" 
        :class="{ expanded: node.expanded, loading: node.loading }"
        @click.stop="$emit('toggle-node', node)"
      >
        {{ node.loading ? '⏳' : (node.hasChildren !== false ? (node.expanded ? '▼' : '▶') : '·') }}
      </span>
      <span class="node-icon">📁</span>
      <span class="node-name" :title="node.name">{{ node.name }}</span>
    </div>

    <!-- 递归自调用：支持 3 级、4 级、N 级无限递归展开！ -->
    <div v-if="node.expanded && node.children && node.children.length" class="tree-children-box">
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :current-path="currentPath"
        @select-node="$emit('select-node', $event)"
        @toggle-node="$emit('toggle-node', $event)"
      />
    </div>
  </div>
</template>

<script setup>
defineProps({
  node: { type: Object, required: true },
  currentPath: { type: String, default: '' }
});

defineEmits(['select-node', 'toggle-node']);
</script>

<style scoped>
.tree-node-wrapper {
  display: flex;
  flex-direction: column;
}

.tree-node-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--mi-text-main, #334155);
  transition: all 0.15s;
}

.tree-node-item:hover {
  background: var(--mi-control-sub-bg, #f1f5f9);
}

.tree-node-item.active {
  background: rgba(255, 103, 0, 0.12);
  color: var(--mi-orange);
  font-weight: 600;
}

.node-arrow {
  font-size: 9px;
  color: #94a3b8;
  width: 14px;
  text-align: center;
  cursor: pointer;
  transition: transform 0.15s;
}

.node-arrow:hover {
  color: var(--mi-orange);
}

.node-arrow.expanded {
  color: var(--mi-orange);
}

.node-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.node-icon {
  font-size: 14px;
}

.tree-children-box {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>
