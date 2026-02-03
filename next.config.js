/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Разрешаем картинки как с нашего сервера, так и с внешних источников (например, Яндекс.Диск)
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'downloader.disk.yandex.ru',
      },
      {
        protocol: 'https',
        hostname: 'disk.yandex.ru',
      },
    ],
  },
}

module.exports = nextConfig
