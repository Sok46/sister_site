function splitIds(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function getTelegramAdminChatIds(): string[] {
  const many = splitIds(process.env.TELEGRAM_ADMIN_CHAT_IDS)
  const single = splitIds(process.env.TELEGRAM_ADMIN_CHAT_ID)
  return [...new Set([...many, ...single])]
}
