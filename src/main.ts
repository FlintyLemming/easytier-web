import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'

// Pinia first: the router guard uses stores during the initial navigation.
createApp(App).use(createPinia()).use(i18n).use(router).mount('#app')
