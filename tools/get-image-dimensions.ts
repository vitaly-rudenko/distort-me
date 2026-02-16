import { execSync } from 'node:child_process'

export async function getImageDimensions(input: { path: string }) {
  const results = execSync(
    `docker run --rm \
    -v "./local:/local" \
    imagemagick identify -format '%w %h' "${input.path}"`,
  )

  const dimensions = results.toString('utf-8')
  const [width, height] = dimensions.split(' ').map(Number)

  return [width, height] as [number, number]
}
