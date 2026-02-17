import { NextRequest, NextResponse } from 'next/server'
import {
  addYogaVideo,
  createMerchProduct,
  createPlaylistItem,
  createPost,
  createYogaPackage,
  deleteMerchProduct,
  deletePlaylistItem,
  deletePost,
  deleteYogaPackage,
  deleteYogaVideo,
  getAdminContentSnapshot,
  updateHomeGallerySelection,
  updateHomeHero,
  updateMerchProduct,
  updatePlaylistItem,
  updatePost,
  updateYogaPackage,
  updateYogaVideo,
} from '@/lib/admin-content'
import { requireAdminToken } from '@/lib/admin-auth'
import type { PlaylistItem } from '@/lib/playlist'
import type { Post } from '@/lib/posts'
import type { Product as MerchProduct } from '@/lib/merch'
import type { VideoLesson, YogaPackage } from '@/lib/yoga'
import type { HomeHeroSettings } from '@/lib/home-hero'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AdminAction =
  | 'yoga.createPackage'
  | 'yoga.updatePackage'
  | 'yoga.deletePackage'
  | 'yoga.addVideo'
  | 'yoga.updateVideo'
  | 'yoga.deleteVideo'
  | 'playlist.createItem'
  | 'playlist.updateItem'
  | 'playlist.deleteItem'
  | 'posts.create'
  | 'posts.update'
  | 'posts.delete'
  | 'merch.createProduct'
  | 'merch.updateProduct'
  | 'merch.deleteProduct'
  | 'gallery.setHomePhotos'
  | 'home.updateHero'

interface ActionBody {
  action: AdminAction
  packageId?: string
  packagePatch?: Partial<YogaPackage>
  videoIndex?: number
  videoPatch?: Partial<VideoLesson>
  playlistItem?: PlaylistItem
  playlistItemId?: string
  post?: Post
  postId?: string
  merchProduct?: MerchProduct
  merchProductId?: string
  homeGallerySelection?: string[]
  homeHero?: Partial<HomeHeroSettings>
}

async function executeAction(body: ActionBody): Promise<void> {
  switch (body.action) {
    case 'yoga.createPackage':
      await createYogaPackage()
      return
    case 'yoga.updatePackage':
      if (!body.packageId) throw new Error('packageId обязателен')
      await updateYogaPackage(body.packageId, body.packagePatch || {})
      return
    case 'yoga.deletePackage':
      if (!body.packageId) throw new Error('packageId обязателен')
      await deleteYogaPackage(body.packageId)
      return
    case 'yoga.addVideo':
      if (!body.packageId) throw new Error('packageId обязателен')
      await addYogaVideo(body.packageId)
      return
    case 'yoga.updateVideo':
      if (!body.packageId) throw new Error('packageId обязателен')
      if (typeof body.videoIndex !== 'number') throw new Error('videoIndex обязателен')
      await updateYogaVideo(body.packageId, body.videoIndex, body.videoPatch || {})
      return
    case 'yoga.deleteVideo':
      if (!body.packageId) throw new Error('packageId обязателен')
      if (typeof body.videoIndex !== 'number') throw new Error('videoIndex обязателен')
      await deleteYogaVideo(body.packageId, body.videoIndex)
      return
    case 'playlist.createItem':
      await createPlaylistItem()
      return
    case 'playlist.updateItem':
      if (!body.playlistItem) throw new Error('playlistItem обязателен')
      await updatePlaylistItem(body.playlistItem)
      return
    case 'playlist.deleteItem':
      if (!body.playlistItemId) throw new Error('playlistItemId обязателен')
      await deletePlaylistItem(body.playlistItemId)
      return
    case 'posts.create':
      await createPost()
      return
    case 'posts.update':
      if (!body.post) throw new Error('post обязателен')
      await updatePost(body.post)
      return
    case 'posts.delete':
      if (!body.postId) throw new Error('postId обязателен')
      await deletePost(body.postId)
      return
    case 'merch.createProduct':
      await createMerchProduct()
      return
    case 'merch.updateProduct':
      if (!body.merchProduct?.id) throw new Error('merchProduct.id обязателен')
      await updateMerchProduct(body.merchProduct.id, body.merchProduct)
      return
    case 'merch.deleteProduct':
      if (!body.merchProductId) throw new Error('merchProductId обязателен')
      await deleteMerchProduct(body.merchProductId)
      return
    case 'gallery.setHomePhotos':
      if (!Array.isArray(body.homeGallerySelection)) {
        throw new Error('homeGallerySelection обязателен')
      }
      await updateHomeGallerySelection(body.homeGallerySelection)
      return
    case 'home.updateHero':
      if (!body.homeHero || typeof body.homeHero !== 'object') {
        throw new Error('homeHero обязателен')
      }
      await updateHomeHero(body.homeHero)
      return
    default:
      throw new Error('Неизвестное действие')
  }
}

export async function GET(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  const snapshot = await getAdminContentSnapshot()
  return NextResponse.json(snapshot)
}

export async function POST(request: NextRequest) {
  const denied = requireAdminToken(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as ActionBody
    if (!body?.action) {
      return NextResponse.json({ error: 'action обязателен' }, { status: 400 })
    }

    await executeAction(body)
    const snapshot = await getAdminContentSnapshot()
    return NextResponse.json({ success: true, ...snapshot })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка выполнения действия'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
