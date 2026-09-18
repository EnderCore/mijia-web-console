<template>
  <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <div class="modal-title">
          <span class="icon">🎬</span>
          <h4>小米智能存储 · 官方影视墙 (Web 原生界面)</h4>
        </div>
        <div class="modal-actions">
          <a :href="mediaUrl" target="_blank" class="open-tab-btn" title="在新标签页全屏打开">
            在新标签页打开 ↗
          </a>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
      </div>

      <div class="modal-body">
        <iframe :src="mediaUrl" class="media-frame" frameborder="0"></iframe>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  mediaUrl: { type: String, default: '' }
});

defineEmits(['close']);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-container {
  width: 90vw;
  height: 85vh;
  max-width: 1300px;
  background: #ffffff;
  border-radius: var(--mi-radius-lg);
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--mi-border);
  background: #fcfdfe;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title .icon {
  font-size: 20px;
}

.modal-title h4 {
  font-size: 15px;
  font-weight: 700;
  color: var(--mi-text-main);
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.open-tab-btn {
  font-size: 13px;
  color: var(--mi-orange);
  text-decoration: none;
  font-weight: 600;
}

.open-tab-btn:hover {
  text-decoration: underline;
}

.close-btn {
  font-size: 18px;
  color: var(--mi-text-sub);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #f0f2f5;
  color: var(--mi-text-main);
}

.modal-body {
  flex: 1;
  width: 100%;
  height: 100%;
  background: #000000;
}

.media-frame {
  width: 100%;
  height: 100%;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}
</style>
