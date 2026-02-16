import { exec } from 'node:child_process'

export async function distortImage(input: {
  inputPath: string
  outputPath: string
  width: number
  height: number
  percentage: number
}) {
  // TODO: commented out because paths in docker and outside are different
  // await fs.mkdir(dirname(input.outputPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    exec(
      `docker run --rm \
       -v "./local:/local" \
       imagemagick "${input.inputPath}" -liquid-rescale '${Math.floor(input.percentage * 100)}%' -resize '${input.width}x${input.height}' "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
