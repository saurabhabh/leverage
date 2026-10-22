import { existsSync } from 'fs'
import { mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { execFfmpeg } from './ffmpeg'

/**
 * A 512×512 white-circle-on-black PNG used with alphamerge to cut the camera into a circle.
 * Generated once per recording folder (the per-pixel geq runs on one frame, not every frame).
 */
export async function ensureCircleMask(dir: string): Promise<string> {
  const folder = join(dir, 'overlays')
  const path = join(folder, 'mask.png')
  if (existsSync(path)) return path
  await mkdir(folder, { recursive: true })
  const temp = join(folder, 'mask.tmp.png')
  await execFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=512x512,format=gray',
    '-vf', "geq=lum='if(lte(hypot(X-255.5,Y-255.5),256),255,0)'",
    '-frames:v', '1', temp
  ])
  await rename(temp, path)
  return path
}
