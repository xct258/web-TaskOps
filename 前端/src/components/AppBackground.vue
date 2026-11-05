<script setup>
import { wallpaper, wallpaperFading, wallpaperNext } from '@/composables/useWallpaper'
</script>

<template>
  <!-- 动态壁纸 + 轻调光：无暗角，壁纸全幅清晰 -->
  <div class="fixed inset-0 z-0 pointer-events-none select-none overflow-hidden">
    <!-- 底层：当前壁纸（提前挂载，配合加载页把渐进加载藏在遮罩后面） -->
    <div
      class="absolute inset-0 bg-cover bg-center bg-no-repeat"
      :style="{ backgroundImage: wallpaper }"
    />
    <!-- 顶层：切换时铺新图并淡入（background-image 本身不可过渡，靠 opacity 交叉淡入） -->
    <div
      v-show="wallpaperNext"
      class="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000 ease-out"
      :class="wallpaperFading ? 'opacity-100' : 'opacity-0'"
      :style="{ backgroundImage: wallpaperNext }"
    />
    <!-- 整体压暗：无暗角、无模糊，靠暗度保证内容可读 -->
    <div class="absolute inset-0 bg-slate-950/75 md:bg-slate-950/70" />
  </div>
</template>
