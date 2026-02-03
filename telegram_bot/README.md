# Telegram: уведомления о записях

Бот нужен для **получения уведомлений** о новых записях и **просмотра слотов**.

- Уведомления приходят автоматически с сайта в chat_id из `.env`
- Слоты добавляются вручную в `content/bookings/available-slots.json` — см. BOOKING_GUIDE.md

**Команды:** `/slots` — все слоты; `/slots 2025-02-10` — слоты на дату (свободные и занятые).

## Настройка

В `.env` в корне проекта:

```
TELEGRAM_BOT_TOKEN=токен_от_BotFather
TELEGRAM_ADMIN_CHAT_ID=ваш_chat_id
```

- Токен — из [@BotFather](https://t.me/BotFather)
- chat_id — из [@userinfobot](https://t.me/userinfobot)

## Запуск бота (необязательно)

Бот **не нужно запускать** для уведомлений — их отправляет сайт. Запускать имеет смысл только для команд `/start` и `/slots` в Telegram.

**Локально (Windows):** `run.bat`

**На сервере (Ubuntu):** см. ниже.

---

## Запуск бота на сервере

1. Установить Python и зависимости (один раз):

```bash
cd ~/sister_site
sudo apt install -y python3 python3-pip
pip3 install -r telegram_bot/requirements.txt
```

2. Проверить, что в `~/sister_site/.env` есть `TELEGRAM_BOT_TOKEN` и `TELEGRAM_ADMIN_CHAT_ID`.

3. Запуск в фоне через PM2 (как сайт):

```bash
cd ~/sister_site
pm2 start telegram_bot/bot.py --name telegram-bot --interpreter python3 --cwd /root/sister_site
pm2 save
```

Если используете venv: `--interpreter /root/sister_site/venv-bot/bin/python`.

4. Проверка: `pm2 status` (должны быть sister-site и telegram-bot). В Telegram отправьте боту `/start` или `/slots`.
