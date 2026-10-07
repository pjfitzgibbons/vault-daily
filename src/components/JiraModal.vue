<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" data-action="jira-modal-backdrop" @click.self="emitClose('backdrop')">
      <div class="modal">
        <h3>Submit Standup to Jira</h3>
        <p class="info">
          Jira credentials and field IDs are configured in
          <code>config.json</code> at the vault root.
          The server proxies requests — no credentials leave your machine.
        </p>
        <div v-if="statusMsg" class="status-msg" :class="statusClass">{{ statusMsg }}</div>
        <div class="actions">
          <button data-action="jira-modal-cancel" @click="emitClose('cancel')">Cancel</button>
          <button class="primary" :disabled="submitting" data-action="jira-modal-submit" @click="emitSubmit">
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
const emit = defineEmits(['close', 'submit'])

function emitClose(source) {
  emit('close', source)
}

function emitSubmit() {
  emit('submit', 'modal-submit')
}
</script>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--c-backdrop);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: var(--c-bg-panel);
  border: 1px solid var(--c-border);
  border-radius: 6px;
  padding: 20px;
  width: 420px;
  max-width: 92vw;
}
h3 { font-size: 15px; margin: 0 0 12px; color: var(--c-text); }
.info { font-size: 12px; color: var(--c-text-dim); line-height: 1.5; margin: 0; }
code { background: var(--c-bg-input); padding: 1px 4px; border-radius: 2px; }
.status-msg { margin-top: 10px; font-size: 12px; }
.status-msg.ok  { color: var(--c-done); }
.status-msg.err { color: var(--c-danger); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
button {
  background: var(--c-bg-input);
  border: 1px solid var(--c-border);
  color: var(--c-text);
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
button:hover:not(:disabled) { background: var(--c-border); }
button:disabled { opacity: .4; cursor: default; }
.primary { background: var(--c-accent); border-color: var(--c-accent); color: #fff; }
.primary:hover:not(:disabled) { background: var(--c-accent-hover); }
</style>
