import { exec } from 'node:child_process'

// TODO: better variable names
export async function combineFrames(input: {
  inputPath: string
  inputDirectory: string
  outputPath: string
  sampleRate: number | null
  percentage: number
  pitch: number
  audio: boolean
}) {
  if (input.audio !== Boolean(input.sampleRate)) {
    throw new Error('Both sampleRate and audio must be set or unset at the same time')
  }

  const filters = [
    //
    input.audio && input.percentage !== 0 && `vibrato=f=10:d=${input.percentage}`,
    input.audio &&
      input.pitch !== 1 &&
      `asetrate=${input.sampleRate}*${input.pitch},aresample=${input.sampleRate},atempo=1/${input.pitch}`,
  ].filter(Boolean)

  const filterArgument = filters.length > 0 ? ` -filter:a "${filters.join(',')}"` : ''

  // scale is needed for libx264 (it requires even dimensions)
  await new Promise<void>((resolve, reject) => {
    exec(
      `ffmpeg \
       -framerate 24 \
       -start_number 1 \
       -i "${input.inputDirectory}/%d.jpg" \
       ${input.audio ? `-i "${input.inputPath}"` : ''} \
       ${filterArgument} \
       -map 0:v:0 \
       ${input.audio ? `-map 1:a:0` : ''} \
       ${input.audio ? `-c:a libopus` : ''} \
       ${input.audio ? `-b:a 192k` : ''} \
       -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
       -c:v libx264 \
       -crf 18 \
       -preset slow \
       -pix_fmt yuv420p \
       "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
