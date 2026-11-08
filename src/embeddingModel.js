import { DeviceEventEmitter, Platform, TurboModuleRegistry } from 'react-native';

let embedder;
let loading;
const nativeModelAvailable = () => !!TurboModuleRegistry.get('ReactNativeBlobUtil');
let status = { state: nativeModelAvailable() ? 'idle' : 'unavailable', progress: 0, error: null };

function publish(next) {
  status = next;
  DeviceEventEmitter.emit('embeddingModelChanged', status);
}

export function embeddingModelStatus() { return status; }

export async function getEmbedder() {
  if (!nativeModelAvailable()) throw new Error('On-device model needs a development build');
  if (embedder) return embedder;
  if (!loading) {
    publish({ state: 'downloading', progress: 0, error: null });
    loading = (async () => {
      const { createTextEmbedder, download, models } = await import('react-native-executorch');
      // shortcut: Android uses CPU until Vulkan model loading is safe on older GPUs.
      const model = Platform.OS === 'android' ? models.textEmbeddings.ALL_MINILM_L6_V2.XNNPACK_INT8 : models.textEmbeddings.ALL_MINILM_L6_V2.DEFAULT;
      const resource = await download(model, {
        onProgress: (progress) => publish({ state: 'downloading', progress, error: null }),
      });
      publish({ state: 'loading', progress: 1, error: null });
      embedder = await createTextEmbedder(resource);
      publish({ state: 'ready', progress: 1, error: null });
      return embedder;
    })().catch((error) => {
      const unavailable = error?.message?.includes('native module is not available');
      publish({ state: unavailable ? 'unavailable' : 'error', progress: status.progress, error: error?.message ?? 'Model download failed' });
      throw error;
    }).finally(() => { loading = null; });
  }
  return loading;
}

export function disposeEmbedder() {
  embedder?.dispose();
  embedder = undefined;
  publish({ state: 'idle', progress: 0, error: null });
}
