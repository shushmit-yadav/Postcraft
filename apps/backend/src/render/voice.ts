import fs from 'node:fs/promises';
import path from 'node:path';
import { probe, runFfmpeg } from './ffmpeg.js';

/**
 * Offline text-to-speech through FFmpeg's built-in flite voice: no API key, no network.
 * shortcut: flite sounds robotic; swap in Piper (local neural TTS) or a hosted voice when quality matters.
 */
export async function synthesizeSpeech(text: string, workDir: string, name: string, signal: AbortSignal) {
  // Text goes through a file, never the filter string, so no escaping is needed.
  const textFile = path.join(workDir, `${name}.txt`);
  const out = path.join(workDir, `${name}.wav`);
  await fs.writeFile(textFile, text.replace(/[…]/g, '.'));
  await runFfmpeg(['-f', 'lavfi', '-i', `flite=textfile=${textFile}:voice=slt`, '-ar', '44100', '-ac', '2', out], { signal });
  const { durationSec } = await probe(out, signal);
  return { path: out, durationSec: durationSec ?? 0 };
}
