import { exec } from 'node:child_process'

export async function distortAudio(input: {
  inputPath: string
  outputPath: string
  sampleRate: number
  percentage: number
  pitch: number
  format: 'mp3' | 'ogg'
}) {
  const filters = [
    //
    input.percentage !== 0 && `vibrato=f=10:d=${input.percentage}`,
    input.pitch !== 1 &&
      `asetrate=${input.sampleRate}*${input.pitch},aresample=${input.sampleRate},atempo=1/${input.pitch}`,
  ].filter(Boolean)

  const filterArgument = filters.length > 0 ? ` -filter:a "${filters.join(',')}"` : ''

  await new Promise<void>((resolve, reject) => {
    exec(
      `ffmpeg \
       -i "${input.inputPath}" \
       ${filterArgument} \
       ${input.format === 'ogg' ? '-c:a libopus' : ''} \
       ${input.format === 'mp3' ? '-c:a libmp3lame' : ''} \
       -b:a 192k \
       "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
