<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { CompressionAlgoPb, declaredDefault, type NetworkConfig } from '../../lib/networkConfig'
import CheckboxField from './CheckboxField.vue'
import EditorSection from './EditorSection.vue'
import { flagOn, setFlag } from './rules'
import { FIELD_CLASS, LABEL_CLASS } from './styles'

const props = defineProps<{ draft: NetworkConfig }>()
const { t } = useI18n()
const algoId = useId()
const compressId = useId()

const ALGORITHMS = ['aes-gcm', 'aes-256-gcm', 'chacha20', 'xor']
const COMPRESSIONS = [CompressionAlgoPb.None, CompressionAlgoPb.Zstd, CompressionAlgoPb.Lzo]
const defaultAlgorithm = String(declaredDefault('encryption_algorithm') ?? 'aes-gcm')
const defaultCompression = CompressionAlgoPb[(declaredDefault('data_compress_algo') ?? 'None') as keyof typeof CompressionAlgoPb]

const encrypted = computed(() => !flagOn(props.draft, 'disable_encryption'))
const algorithm = computed(() => props.draft.encryption_algorithm || defaultAlgorithm)
// Normalized drafts hold the protobuf enum number.
const compression = computed(() => props.draft.data_compress_algo ?? defaultCompression)

// A value the form does not offer (written elsewhere) stays selectable instead of showing blank.
const algorithms = computed(() => (ALGORITHMS.includes(algorithm.value) ? ALGORITHMS : [algorithm.value, ...ALGORITHMS]))
const compressions = computed(() => (COMPRESSIONS.includes(compression.value) ? COMPRESSIONS : [compression.value, ...COMPRESSIONS]))

// Like a switch: picking the default leaves the field out.
function setAlgorithm(value: string) {
  if (value === defaultAlgorithm) delete props.draft.encryption_algorithm
  else props.draft.encryption_algorithm = value
}

function setCompression(value: string) {
  const algo = Number(value) as CompressionAlgoPb
  if (algo === defaultCompression) delete props.draft.data_compress_algo
  else props.draft.data_compress_algo = algo
}
</script>

<template>
  <EditorSection name="crypto" :title="t('config.section.crypto')">
    <CheckboxField
      :model-value="encrypted"
      :label="t('config.field.encryption')"
      @update:model-value="(v) => setFlag(draft, 'disable_encryption', !v)"
    />
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="flex flex-col gap-1.5">
        <label :for="algoId" :class="LABEL_CLASS">{{ t('config.field.encryptionAlgorithm') }}</label>
        <select
          :id="algoId"
          :value="algorithm"
          :disabled="!encrypted"
          :class="[FIELD_CLASS, 'cursor-pointer border-hairline-strong font-mono']"
          @change="setAlgorithm(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="a in algorithms" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>
      <div class="flex flex-col gap-1.5">
        <label :for="compressId" :class="LABEL_CLASS">{{ t('config.field.compression') }}</label>
        <select
          :id="compressId"
          :value="String(compression)"
          :class="[FIELD_CLASS, 'cursor-pointer border-hairline-strong font-mono']"
          @change="setCompression(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="c in compressions" :key="c" :value="String(c)">{{ CompressionAlgoPb[c] ?? c }}</option>
        </select>
      </div>
    </div>
  </EditorSection>
</template>
