import gc
import json
import os
import sys
import time
import traceback
import wave

import numpy as np
import torch
import whisper


model = None
model_name = None
model_dir = None
model_device = None

# Biases decoding toward these terms so common technical/interview vocabulary
# isn't misheard as similar-sounding everyday words (e.g. "Coroutines" as
# "collagens"). Whisper only attends to roughly the last ~224 prompt tokens,
# so this stays a flat term list rather than prose.
TECHNICAL_VOCAB_PROMPT = (
    "Kotlin, Coroutines, Android, Jetpack Compose, Retrofit, Gradle, AOSP, "
    "React, React Native, TypeScript, Java, API, CI/CD, GraphQL, Git, Docker, "
    "Kubernetes, architecture, repository, dependency injection, lifecycle, "
    "ViewModel, Flow, RxJava"
)


def send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def unload_model():
    global model, model_name, model_dir, model_device
    model = None
    model_name = None
    model_dir = None
    model_device = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def ensure_model(request):
    global model, model_name, model_dir, model_device
    requested_name = request.get('model') or 'small'
    requested_dir = request.get('model_dir') or None
    requested_device = request.get('device') or 'auto'
    if requested_device == 'auto':
        requested_device = 'cuda' if torch.cuda.is_available() else 'cpu'

    if requested_device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError(
            'CUDA was requested but this Python environment has no CUDA-enabled PyTorch build'
        )

    freshly_loaded = False
    load_ms = 0.0
    if (
        model is None
        or model_name != requested_name
        or model_dir != requested_dir
        or model_device != requested_device
    ):
        unload_model()
        load_started = time.perf_counter()
        model = whisper.load_model(
            requested_name,
            device=requested_device,
            download_root=requested_dir,
        )
        load_ms = (time.perf_counter() - load_started) * 1000
        model_name = requested_name
        model_dir = requested_dir
        model_device = requested_device
        freshly_loaded = True

    return model, requested_device, load_ms, freshly_loaded


def load_audio_input(audio_path):
    """Read the app's PCM WAV directly so ffmpeg is not required for recording.

    Returns (processed_input, duration_seconds). duration_seconds is None
    when the fallback (Whisper's own ffmpeg-backed filename loader) is used,
    since we haven't decoded the audio ourselves in that case.
    """
    if not str(audio_path).lower().endswith('.wav'):
        return audio_path, None

    try:
        with wave.open(audio_path, 'rb') as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            n_frames = wav_file.getnframes()
            frames = wav_file.readframes(n_frames)

        duration_seconds = (n_frames / sample_rate) if sample_rate else None

        if sample_width != 2:
            return audio_path, duration_seconds

        samples = np.frombuffer(frames, dtype='<i2').astype(np.float32)
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        samples /= 32768.0

        if sample_rate != whisper.audio.SAMPLE_RATE and samples.size:
            output_size = max(1, round(samples.size * whisper.audio.SAMPLE_RATE / sample_rate))
            source_positions = np.arange(samples.size, dtype=np.float64)
            target_positions = np.linspace(0, samples.size - 1, output_size)
            samples = np.interp(target_positions, source_positions, samples).astype(np.float32)

        return samples, duration_seconds
    except (OSError, EOFError, wave.Error, ValueError):
        # Non-PCM or malformed WAV files can still use Whisper's normal
        # filename loader when ffmpeg is available on the host.
        return audio_path, None


def _decode(loaded_model, audio_input, language, device):
    """Run the actual Whisper forward pass. Shared by real transcription and
    the post-load dummy warmup call so both pay/skip the same CUDA kernel
    selection cost through the identical code path."""
    started = time.perf_counter()
    result = loaded_model.transcribe(
        audio_input,
        language=language,
        task='transcribe',
        fp16=device == 'cuda',
        verbose=None,
        temperature=0,
        condition_on_previous_text=False,
        initial_prompt=TECHNICAL_VOCAB_PROMPT,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    return result, elapsed_ms


def _synthetic_warmup_audio(duration_sec=1.5):
    """Quiet sine tone, not silence - avoids the no-speech fast path so this
    exercises the same encoder+decoder kernels a real segment would."""
    sample_rate = whisper.audio.SAMPLE_RATE
    t = np.arange(int(sample_rate * duration_sec), dtype=np.float32) / sample_rate
    return (np.sin(2 * np.pi * 220.0 * t) * 0.1).astype(np.float32)


def transcribe(request):
    loaded_model, device, load_ms, freshly_loaded = ensure_model(request)
    language = request.get('language') or None
    if language in ('auto', 'detect'):
        language = None

    audio_input, duration_seconds = load_audio_input(request['audio_path'])

    result, inference_ms = _decode(loaded_model, audio_input, language, device)

    rtf = None
    if duration_seconds:
        rtf = (inference_ms / 1000) / duration_seconds

    segments = result.get('segments') or []
    no_speech_prob = max((s.get('no_speech_prob', 0.0) for s in segments), default=0.0)
    avg_logprob = min((s.get('avg_logprob', 0.0) for s in segments), default=0.0)

    return {
        'text': (result.get('text') or '').strip(),
        'language': result.get('language'),
        'device': device,
        'model': model_name,
        'cuda_available': torch.cuda.is_available(),
        'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        # Whisper's own confidence signals for this segment - used downstream
        # to drop low-confidence/likely-hallucinated output at the source
        # instead of relying only on text-pattern matching after the fact.
        'noSpeechProb': no_speech_prob,
        'avgLogprob': avg_logprob,
        # Diagnostic timing - see scripts/whisper_worker.py CUDA diagnostics.
        'audioDurationSec': duration_seconds,
        'modelLoadMs': load_ms,
        'modelFreshlyLoaded': freshly_loaded,
        'inferenceMs': inference_ms,
        'rtf': rtf,
    }


send({
    'event': 'ready',
    'pid': os.getpid(),
    'torch': torch.__version__,
    'cuda_available': torch.cuda.is_available(),
    'torch_cuda': torch.version.cuda,
    'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
})

for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue

    request_id = None
    try:
        request = json.loads(raw_line)
        request_id = request.get('id')
        action = request.get('action')

        if action == 'transcribe':
            send({'id': request_id, 'ok': True, **transcribe(request)})
        elif action == 'warmup':
            warmed_model, device, load_ms, freshly_loaded = ensure_model(request)
            # A freshly-loaded CUDA model's first real transcribe() pays a
            # one-time kernel-selection cost (~12s measured on a 20s clip,
            # vs ~0.3s on every call after). Pay that cost here, on a tiny
            # dummy clip, while warmup already runs unawaited at recording
            # start - so the user's first real utterance doesn't eat it.
            warmup_inference_ms = None
            if freshly_loaded and device == 'cuda':
                dummy_audio = _synthetic_warmup_audio()
                _, warmup_inference_ms = _decode(warmed_model, dummy_audio, 'en', device)
            send({
                'id': request_id,
                'ok': True,
                'warmed': True,
                'device': device,
                'model': model_name,
                'cuda_available': torch.cuda.is_available(),
                'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
                'modelLoadMs': load_ms,
                'modelFreshlyLoaded': freshly_loaded,
                'warmupInferenceMs': warmup_inference_ms,
            })
        elif action == 'unload':
            unload_model()
            send({'id': request_id, 'ok': True, 'unloaded': True})
        elif action == 'shutdown':
            unload_model()
            send({'id': request_id, 'ok': True, 'shutdown': True})
            break
        else:
            raise ValueError(f'Unsupported worker action: {action}')
    except Exception as error:
        send({
            'id': request_id,
            'ok': False,
            'error': str(error),
            'traceback': traceback.format_exc(),
        })
