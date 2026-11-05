<script setup>
import { onMounted, ref } from 'vue'

import { useLoginViewport } from '@/composables/useLoginViewport'
import { auth, signIn } from '@/composables/useAuth'

const password = ref('')
const inputEl = ref(null)
const keyboardInset = useLoginViewport()

onMounted(() => inputEl.value?.focus())

async function submit() {
  if (!password.value || auth.loading) return
  const ok = await signIn(password.value)
  if (!ok) {
    password.value = ''
    inputEl.value?.focus()
  }
}
</script>

<template>
  <div
    class="relative z-10 h-full w-full flex items-center justify-center px-4 py-6 overflow-hidden transition-[padding-bottom] duration-200 ease-out"
    :style="keyboardInset ? { paddingBottom: `${keyboardInset + 24}px` } : undefined"
  >
    <form
      class="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/80 p-6 sm:p-7 shadow-2xl animate-scale-in"
      @submit.prevent="submit"
    >
      <p class="text-[11px] font-mono text-slate-400 mb-5">请输入访问密码后继续</p>

      <label class="block text-[10px] font-mono text-slate-500 mb-1.5" for="taskops-password">访问密码</label>
      <input
        id="taskops-password"
        ref="inputEl"
        v-model="password"
        type="password"
        autocomplete="current-password"
        placeholder="••••••••"
        class="w-full px-3 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-white text-sm placeholder-slate-600 focus:outline-none focus:border-sky-400 transition"
        @input="auth.error = ''"
      />

      <p v-if="auth.error" class="mt-2 text-[11px] text-rose-300">{{ auth.error }}</p>

      <button
        type="submit"
        :disabled="auth.loading || !password"
        class="mt-4 w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-mono transition border border-sky-400/30 shadow-lg shadow-sky-500/10"
      >
        {{ auth.loading ? '验证中…' : '进入控制台' }}
      </button>
    </form>
  </div>
</template>
