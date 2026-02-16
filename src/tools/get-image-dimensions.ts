import { exec } from 'node:child_process'

export async function getImageDimensions(input: { path: string }) {
  const dimensions = await new Promise<string>((resolve, reject) => {
    exec(
      `magick identify \
       -format '%w %h' \
       "${input.path}"`,
      (err, result) => (err ? reject(err) : resolve(result)),
    )
  })

  const [width, height] = dimensions.split(' ').map(Number)
  return [width, height] as [number, number]
}
