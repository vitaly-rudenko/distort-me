import { exec } from 'node:child_process'

export async function distortImage(input: {
  inputPath: string
  outputPath: string
  width: number
  height: number
  rescale: number
}) {
  await new Promise<void>((resolve, reject) => {
    exec(
      `magick \
       "${input.inputPath}" \
       -liquid-rescale '${Math.floor(input.rescale)}%' \
       -resize '${input.width}x${input.height}' \
       -quality 100 \
       "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
