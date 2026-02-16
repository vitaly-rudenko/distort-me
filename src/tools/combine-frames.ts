import { exec } from 'node:child_process'

// TODO: better variable names
export async function combineFrames(input: {
  inputPath: string
  inputDirectory: string
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
       -framerate 24 \
       -start_number 1 \
       -i "${input.inputDirectory}/%d.jpg" \
       -i "${input.inputPath}" \
       ${filterArgument} \
       -c:a libopus \
       -b:a 192k \
       -shortest \
       -c:v libx264 \
       -crf 18 \
       -preset slow \
       -pix_fmt yuv420p \
       "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
