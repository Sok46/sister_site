import { NextResponse } from 'next/server'
import { getAllPackages } from '@/lib/yoga'

export const dynamic = 'force-dynamic'

export async function GET() {
  const packages = getAllPackages()
  return NextResponse.json({ packages })
}
