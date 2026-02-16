import { exec } from 'node:child_process'

export async function distortAudio(input: {
  inputPath: string
  outputPath: string
  sampleRate: number
  percentage: number
  pitch: number
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
       -c:a libopus \
       -shortest \
       "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
