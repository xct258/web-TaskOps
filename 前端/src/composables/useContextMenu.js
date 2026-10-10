import { reactive } from 'vue'

// 全局单例右键 / 长按菜单：任何页面都通过 useContextMenu().open() 调用，
// 由一个挂在 App 顶层、Teleport 到 body 的 ContextMenu 组件统一渲染。
const state = reactive({
  visible: false,
  x: 0,
  y: 0,
  width: 168,
  title: '',
  items: [],
  swallowClick: false,
})

const ITEM_HEIGHT = 34
const TITLE_HEIGHT = 24
const PAD = 8

export function useContextMenu() {
  return {
    state,
    /**
     * @param {Array<{key:string,label:string,danger?:boolean,disabled?:boolean,action?:Function}>} items
     * @param {number} x 视口坐标
     * @param {number} y 视口坐标
     * @param {{width?:number,title?:string,fromTouch?:boolean}} options
     */
    open(items, x, y, options = {}) {
      const width = options.width ?? 168
      const title = options.title ?? ''
      const height = items.length * ITEM_HEIGHT + (title ? TITLE_HEIGHT : 0) + 12
      state.items = items
      state.title = title
      state.width = width
      state.swallowClick = options.fromTouch === true
      state.x = Math.max(PAD, Math.min(x ?? 0, window.innerWidth - width - PAD))
      state.y = Math.max(PAD, Math.min(y ?? 0, window.innerHeight - height - PAD))
      state.visible = true
    },
    close() {
      state.visible = false
      state.items = []
      state.title = ''
    },
  }
}

export const contextMenuState = state
