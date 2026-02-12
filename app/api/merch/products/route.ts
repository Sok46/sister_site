import { NextResponse } from 'next/server'
import { getAllProducts } from '@/lib/merch'

export const dynamic = 'force-dynamic'

export async function GET() {
  const products = getAllProducts()
  return NextResponse.json({ products })
}
