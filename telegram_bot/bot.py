#!/usr/bin/env python3
"""
Telegram-бот для получения уведомлений о записях на йогу.
Уведомления приходят автоматически с сайта при каждой новой записи.
Слоты добавляются вручную в файл content/bookings/available-slots.json
"""
import json
import os
import re
from pathlib import Path

# Загрузка .env из корня проекта
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import telebot

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Задайте переменную окружения TELEGRAM_BOT_TOKEN")

bot = telebot.TeleBot(BOT_TOKEN)

BASE_DIR = Path(__file__).resolve().parent.parent
SLOTS_FILE = BASE_DIR / "content" / "bookings" / "available-slots.json"
BOOKINGS_FILE = BASE_DIR / "content" / "bookings" / "bookings.json"


def read_slots():
    if not SLOTS_FILE.exists():
        return {}
    with open(SLOTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def read_bookings():
    if not BOOKINGS_FILE.exists():
        return []
    with open(BOOKINGS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def format_date_ru(date_str):
    months = {
        "01": "января", "02": "февраля", "03": "марта", "04": "апреля",
        "05": "мая", "06": "июня", "07": "июля", "08": "августа",
        "09": "сентября", "10": "октября", "11": "ноября", "12": "декабря",
    }
    try:
        y, m, d = date_str.split("-")
        return f"{int(d)} {months.get(m, m)} {y}"
    except Exception:
        return date_str


@bot.message_handler(commands=["start"])
def cmd_start(message):
    text = (
        "🧘 Этот бот получает уведомления о новых записях на йогу.\n\n"
        "Команды:\n"
        "• /slots — показать все слоты\n"
        "• /slots ГГГГ-ММ-ДД — слоты на дату (свободные и занятые)\n\n"
        "Слоты добавляются вручную в available-slots.json на компьютере."
    )
    bot.reply_to(message, text)


@bot.message_handler(commands=["slots"])
def cmd_slots(message):
    parts = message.text.split()
    slots = read_slots()
    if not slots:
        bot.reply_to(message, "Слотов пока нет.")
        return

    if len(parts) >= 2:
        date = parts[1]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            bot.reply_to(message, "Формат даты: ГГГГ-ММ-ДД (например 2025-02-10)")
            return
        if date not in slots:
            bot.reply_to(message, f"На {format_date_ru(date)} слотов нет.")
            return
        times = slots[date]
        bookings = read_bookings()
        booked = {b["time"] for b in bookings if b["date"] == date}
        free = [t for t in times if t not in booked]
        taken = [t for t in times if t in booked]
        lines = [f"📅 {format_date_ru(date)}"]
        if free:
            lines.append("Свободно: " + ", ".join(free))
        if taken:
            lines.append("Занято: " + ", ".join(taken))
        bot.reply_to(message, "\n".join(lines))
    else:
        lines = ["📋 Слоты по датам:\n"]
        for d in sorted(slots.keys()):
            times = slots[d]
            bookings = read_bookings()
            booked = {b["time"] for b in bookings if b["date"] == d}
            free = [t for t in times if t not in booked]
            status = "свободно: " + ", ".join(free) if free else "все заняты"
            lines.append(f"• {format_date_ru(d)} — {status}")
        bot.reply_to(message, "\n".join(lines))


if __name__ == "__main__":
    print("Бот запущен. Уведомления приходят с сайта, бот отвечает на /start.")
    print("Нажмите Ctrl+C для остановки.")
    bot.infinity_polling()
