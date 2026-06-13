<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" @click.self="emit('close')">
      <div class="modal">
        <h3>Submit Standup to Jira</h3>
        <p class="info">
          Jira credentials and field IDs are configured in
          <code>config.json</code> next to <code>server.js</code>.
          The server proxies requests — no credentials leave your machine.
        </p>
        <div v-if="statusMsg" class="status-msg" :class="statusClass">{{ statusMsg }}</div>
        <div class="actions">
          <button @click="emit('close')">Cancel</button>
          <button class="primary" :disabled="submitting" @click="emit('submit')">
            {{ submitting ? 'Submitting…' : 'Submit' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  open:       { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  statusMsg:  { type: String,  default: '' },
  statusClass:{ type: String,  default: '' },
})
defineEmits(['close', 'submit'])
</script>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: #252526;
  border: 1px solid #3e3e42;
  border-radius: 6px;
  padding: 20px;
  width: 420px;
  max-width: 92vw;
}
h3 { font-size: 15px; margin: 0 0 12px; color: #cccccc; }
.info { font-size: 12px; color: #808080; line-height: 1.5; margin: 0; }
code { background: #2d2d30; padding: 1px 4px; border-radius: 2px; }
.status-msg { margin-top: 10px; font-size: 12px; }
.status-msg.ok  { color: #4ec9b0; }
.status-msg.err { color: #f66; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
button {
  background: #2d2d30;
  border: 1px solid #3e3e42;
  color: #cccccc;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
button:hover:not(:disabled) { background: #3e3e42; }
button:disabled { opacity: .4; cursor: default; }
.primary { background: #007acc; border-color: #007acc; color: #fff; }
.primary:hover:not(:disabled) { background: #1a8ad4; }
</style>
