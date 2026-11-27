import { assert } from '../../core/assert';
import { DICTATION_LIMITS } from './dictationLimits';

export const WHISPER_MODEL_IDS = ['turbo', 'small', 'base'] as const;
export type WhisperModelId = (typeof WHISPER_MODEL_IDS)[number];
export const WHISPER_MODEL_DEFAULT: WhisperModelId = 'turbo';
export const WHISPER_MODEL_FAST: WhisperModelId = 'base';

export interface ModelFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly source?: { readonly repository: string; readonly revision: string };
}

export const VAD_FILE: ModelFile = {
  path: 'vad/silero_vad.onnx',
  sizeBytes: 2_243_022,
  sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
  source: { repository: 'onnx-community/silero-vad', revision: 'e71cae966052b992a7eca6b17738916ce0eca4ec' },
};
export const VAD_FILE_PATH = VAD_FILE.path;

export interface WhisperModel {
  readonly id: WhisperModelId;
  readonly repository: string;
  readonly revision: string;
  readonly license: string;
  readonly files: readonly ModelFile[];
  readonly encoder: 'fp16' | 'q8' | 'q4f16';
  readonly decoder: 'q8' | 'q4f16';
  readonly devices: readonly ('webgpu' | 'wasm')[];
}

export const MODEL_HOSTS = ['huggingface.co'] as const;
export const MODEL_HOST_SUFFIX = '.hf.co';

export const WHISPER_MODELS: { readonly [Id in WhisperModelId]: WhisperModel } = {
  turbo: {
    id: 'turbo',
    repository: 'onnx-community/whisper-large-v3-turbo',
    revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    license: 'MIT',
    encoder: 'q4f16',
    decoder: 'q4f16',
    devices: ['webgpu', 'wasm'],
    files: [
      { path: 'config.json', sizeBytes: 1_332, sha256: '35cd83669f75bc2867f3b3a4461850392d5e308cd6ea951c3700539883c28df1' },
      { path: 'generation_config.json', sizeBytes: 3_897, sha256: '16f95291d2f47c944d3c2b19390bba7965666555c1ea2a0bdc850d1fab45612f' },
      { path: 'preprocessor_config.json', sizeBytes: 340, sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711' },
      { path: 'tokenizer.json', sizeBytes: 2_480_617, sha256: '6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca' },
      { path: 'tokenizer_config.json', sizeBytes: 282_843, sha256: '844b642c73a91359722f47b35705f7174686df33d252695d8572cf9ac03a6389' },
      { path: 'onnx/encoder_model_q4f16.onnx', sizeBytes: 369_974_078, sha256: 'aafd3383f1aa372db0825a885730ebbbae7e34871ec0460428663c69641a63d0' },
      { path: 'onnx/decoder_model_merged_q4f16.onnx', sizeBytes: 193_505_017, sha256: '45981cdd958a4c8e1447839850d2e6e27e30974ccbe31b4a1e5ebe9ad8965a5f' },
      VAD_FILE,
    ],
  },
  small: {
    id: 'small',
    repository: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    license: 'MIT',
    encoder: 'fp16',
    decoder: 'q8',
    devices: ['webgpu', 'wasm'],
    files: [
      { path: 'config.json', sizeBytes: 2_227, sha256: '457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18' },
      { path: 'generation_config.json', sizeBytes: 3_893, sha256: 'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0' },
      { path: 'preprocessor_config.json', sizeBytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', sizeBytes: 2_480_466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
      { path: 'tokenizer_config.json', sizeBytes: 282_683, sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce' },
      { path: 'onnx/encoder_model_fp16.onnx', sizeBytes: 176_607_756, sha256: '5549cd8666ff4b694ceb128bfa48b95bdcceec29075cf2c2212f90002cc058de' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', sizeBytes: 156_750_845, sha256: 'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9' },
      VAD_FILE,
    ],
  },
  base: {
    id: 'base',
    repository: 'onnx-community/whisper-base',
    revision: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c',
    license: 'MIT',
    encoder: 'fp16',
    decoder: 'q8',
    devices: ['webgpu', 'wasm'],
    files: [
      { path: 'config.json', sizeBytes: 2_243, sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b' },
      { path: 'generation_config.json', sizeBytes: 3_832, sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0' },
      { path: 'preprocessor_config.json', sizeBytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
      { path: 'tokenizer.json', sizeBytes: 2_480_466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
      { path: 'tokenizer_config.json', sizeBytes: 282_682, sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573' },
      { path: 'onnx/encoder_model_fp16.onnx', sizeBytes: 41_332_612, sha256: 'ffba51b20185377c1b89362b1128148d0132de936a32b200af973da2a11a5369' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', sizeBytes: 53_693_315, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b' },
      VAD_FILE,
    ],
  },
};

export function modelTotalBytes(model: WhisperModel): number {
  const total = model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  assert(Number.isSafeInteger(total), 'modelTotalBytes: the total is a whole number of bytes');
  assert(total <= DICTATION_LIMITS.downloadBytesMax, 'modelTotalBytes: a model fits the download bound');
  return total;
}

export function modelFileURL(model: WhisperModel, file: ModelFile): string {
  assert(model.files.includes(file), 'modelFileURL: the file belongs to the model');
  const url =
    file.source === undefined
      ? `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.path}`
      : `https://huggingface.co/${file.source.repository}/resolve/${file.source.revision}/onnx/model.onnx`;
  assert(isModelHost(new URL(url)), 'modelFileURL: the address is on a pinned host');
  return url;
}

export function modelSourceURL(model: WhisperModel): string {
  const url = `https://huggingface.co/${model.repository}/tree/${model.revision}`;
  assert(url.startsWith('https://huggingface.co/'), 'modelSourceURL: the source is Hugging Face');
  return url;
}

export function isModelHost(url: URL): boolean {
  if (url.protocol !== 'https:') {
    return false;
  }
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (MODEL_HOSTS.some((allowed) => allowed === host)) {
    return true;
  }
  return host.endsWith(MODEL_HOST_SUFFIX) && host.length > MODEL_HOST_SUFFIX.length;
}

export function parseWhisperModelId(input: unknown): WhisperModelId {
  if (typeof input !== 'string') {
    throw new Error('Expected a model id');
  }
  const found = WHISPER_MODEL_IDS.find((id) => id === input);
  if (found === undefined) {
    throw new Error('Expected a known model id');
  }
  return found;
}

export function isSafeModelPath(path: string): boolean {
  if (path.length === 0 || path.length > 128) {
    return false;
  }
  if (!/^[A-Za-z0-9_.\-/]+$/u.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

for (const id of WHISPER_MODEL_IDS) {
  const model = WHISPER_MODELS[id];
  assert(model.id === id, 'whisperModels: every entry names itself');
  assert(/^[0-9a-f]{40}$/u.test(model.revision), 'whisperModels: the revision is a full commit hash');
  assert(model.files.length > 0, 'whisperModels: a model has files');
  for (const file of model.files) {
    assert(isSafeModelPath(file.path), 'whisperModels: every file path is safe');
    assert(/^[0-9a-f]{64}$/u.test(file.sha256), 'whisperModels: every hash is a SHA-256');
    assert(Number.isSafeInteger(file.sizeBytes), 'whisperModels: every size is whole');
    assert(file.sizeBytes > 0, 'whisperModels: no file is empty');
    assert(file.source === undefined || /^[0-9a-f]{40}$/u.test(file.source.revision), 'whisperModels: a borrowed file is pinned to a commit');
  }
  modelTotalBytes(model);
}

export const WHISPER_LANGUAGES = [
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sv',
  'ta',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh',
] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];
export type DictationLanguage = WhisperLanguage | 'auto';
export const DICTATION_LANGUAGE_DEFAULT: DictationLanguage = 'auto';

export function parseWhisperLanguage(input: unknown): WhisperLanguage | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  return WHISPER_LANGUAGES.find((code) => code === input);
}

export function parseDictationLanguage(input: unknown): DictationLanguage {
  if (input === 'auto') {
    return 'auto';
  }
  return parseWhisperLanguage(input) ?? DICTATION_LANGUAGE_DEFAULT;
}
