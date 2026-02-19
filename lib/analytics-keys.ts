type VideoRef = {
  videoUrl?: string
  rutubeUrl?: string
  rutubeId?: string
}

function compactPart(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function getVideoViewKey(packageId: string, video: VideoRef, index: number): string {
  const source = compactPart(String(video.videoUrl || video.rutubeUrl || video.rutubeId || ''))
  if (source) {
    return `video:${packageId}:${source}`
  }
  return `video:${packageId}:index-${index}`
}

export function getPhotoViewKey(photoPath: string): string {
  return `photo:${compactPart(photoPath)}`
}

export function getMerchViewKey(productId: string): string {
  return `merch:${compactPart(productId)}`
}
