import { exec } from 'node:child_process'

export async function getAudioSampleRate(input: { path: string }) {
  const sampleRate = await new Promise<string>((resolve, reject) => {
    exec(
      `ffprobe \
       -v error \
       -select_streams a \
       -of default=noprint_wrappers=1:nokey=1 \
       -show_entries stream=sample_rate \
       "${input.path}"`,
      (err, result) => (err ? reject(err) : resolve(result)),
    )
  })

  if (!Number.isSafeInteger(Number(sampleRate))) {
    throw new Error(`Could not determine sample rate (path: ${input.path})`)
  }

  return Number(sampleRate)
}
