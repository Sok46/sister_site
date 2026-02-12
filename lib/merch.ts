import fs from 'fs'
import path from 'path'

export interface Product {
  id: string
  name: string
  description: string
  price: number
  sizes: string[]
  color: string
  image: string
  available: boolean
}

export interface MerchOrder {
  id: string
  productId: string
  productName: string
  size: string
  price: number
  name: string
  phone: string
  address: string
  comment: string
  paymentId?: string
  createdAt: string
}

const MERCH_DIR = path.join(process.cwd(), 'content', 'merch')
const PRODUCTS_FILE = path.join(MERCH_DIR, 'products.json')
const ORDERS_FILE = path.join(MERCH_DIR, 'orders.json')

function ensureDir() {
  if (!fs.existsSync(MERCH_DIR)) {
    fs.mkdirSync(MERCH_DIR, { recursive: true })
  }
}

export function getAllProducts(): Product[] {
  ensureDir()
  if (!fs.existsSync(PRODUCTS_FILE)) return []
  try {
    const data = fs.readFileSync(PRODUCTS_FILE, 'utf8')
    return JSON.parse(data) as Product[]
  } catch {
    return []
  }
}

export function getProductById(id: string): Product | undefined {
  return getAllProducts().find((p) => p.id === id)
}

function readOrders(): MerchOrder[] {
  ensureDir()
  if (!fs.existsSync(ORDERS_FILE)) return []
  try {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8')
    return JSON.parse(data) as MerchOrder[]
  } catch {
    return []
  }
}

function writeOrders(orders: MerchOrder[]) {
  ensureDir()
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8')
}

export function createOrder(data: {
  productId: string
  size: string
  name: string
  phone: string
  address: string
  comment: string
  paymentId?: string
}): MerchOrder {
  const product = getProductById(data.productId)
  if (!product) {
    throw new Error('Товар не найден')
  }
  if (!product.available) {
    throw new Error('Товар временно недоступен')
  }
  if (!product.sizes.includes(data.size)) {
    throw new Error('Выбранный размер недоступен')
  }

  const orders = readOrders()

  // Идемпотентность по paymentId
  if (data.paymentId) {
    const existing = orders.find((o) => o.paymentId === data.paymentId)
    if (existing) return existing
  }

  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const order: MerchOrder = {
    id,
    productId: data.productId,
    productName: product.name,
    size: data.size,
    price: product.price,
    name: data.name,
    phone: data.phone,
    address: data.address,
    comment: data.comment,
    paymentId: data.paymentId,
    createdAt: new Date().toISOString(),
  }

  orders.push(order)
  writeOrders(orders)
  return order
}

export function getAllOrders(): MerchOrder[] {
  return readOrders().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}
