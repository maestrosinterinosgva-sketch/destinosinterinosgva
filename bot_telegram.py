"""
bot_telegram.py
Bot de Telegram para la aplicación de Destinos Docentes GVA (Puestos, Centros y Distancias).
Permite al usuario reenviar o subir un PDF de puestos ofertados (*_pue_prov.pdf) desde su smartphone.
El bot descarga el archivo desde Telegram, ejecuta la actualización de destinos,
recalcula distancias y tiempos de tráfico, publica en GitHub Pages y notifica el resultado.
"""
import os
import sys
import json
import urllib.request
import urllib.parse
from actualizar_puestos import main as run_actualizacion
from bot_auto_actualizador import push_to_github

TELEGRAM_CONFIG_FILE = "data/telegram_config.json"

def get_telegram_config():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    
    if os.path.exists(TELEGRAM_CONFIG_FILE):
        try:
            with open(TELEGRAM_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if not token:
                    token = saved.get("token", "")
                if not chat_id:
                    chat_id = saved.get("chat_id", "")
        except Exception:
            pass
            
    return {"token": token, "chat_id": chat_id}

def save_telegram_config(token=None, chat_id=None):
    os.makedirs(os.path.dirname(TELEGRAM_CONFIG_FILE), exist_ok=True)
    cfg = {}
    if os.path.exists(TELEGRAM_CONFIG_FILE):
        try:
            with open(TELEGRAM_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}
    if token:
        cfg["token"] = token
    if chat_id:
        cfg["chat_id"] = str(chat_id)
    with open(TELEGRAM_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

def send_telegram_message(token, chat_id, text):
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[-] Error al enviar mensaje por Telegram: {e}")
        return False

def check_telegram_updates():
    cfg = get_telegram_config()
    token = cfg["token"]
    if not token:
        print("[i] No hay TELEGRAM_BOT_TOKEN configurado. Omitiendo comprobación de Telegram.")
        return False

    offset_file = "data/telegram_last_offset.txt"
    offset = 0
    if os.path.exists(offset_file):
        try:
            with open(offset_file, "r") as f:
                offset = int(f.read().strip())
        except Exception:
            offset = 0

    url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset + 1}&timeout=5"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DestinosBot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[-] Error al consultar getUpdates de Telegram: {e}")
        return False

    if not data.get("ok") or not data.get("result"):
        return False

    updates = data["result"]
    new_pdf_processed = False

    for upd in updates:
        upd_id = upd.get("update_id", offset)
        if upd_id > offset:
            offset = upd_id

        msg = upd.get("message", {})
        chat = msg.get("chat", {})
        chat_id = chat.get("id")
        text = msg.get("text", "")
        doc = msg.get("document")

        if chat_id and not cfg["chat_id"]:
            save_telegram_config(chat_id=chat_id)
            cfg["chat_id"] = str(chat_id)

        # Manejo de comandos
        if text.startswith("/start"):
            welcome = (
                "👋 <b>¡Hola! Soy tu bot de Destinos Docentes GVA (Colegios y Distancias).</b>\n\n"
                "📱 <b>¿Cómo usarme?</b>\n"
                "Cada vez que Conselleria publique puestos ofertados semanales, simplemente <b>reenvíame o súbeme el archivo PDF</b> aquí (*_pue_prov.pdf).\n\n"
                "⚡ Descargaré el archivo, recalcularé las distancias, centros, tiempos de tráfico matinal (8:30-9:00h) y actualizaré la web automáticamente en ~30 segundos."
            )
            send_telegram_message(token, chat_id, welcome)
            continue

        web_url = os.environ.get("WEB_URL") or cfg.get("web_url") or "https://destinos.bolsamaestrosinterinosgva.es/"

        if text.startswith("/status") or text.startswith("/web"):
            status_msg = (
                "🌐 <b>Estado de la Web Destinos GVA:</b>\n"
                f"• Enlace oficial: {web_url}\n"
                "• Puedes enviarme el PDF de puestos ofertados en cualquier momento para actualizar."
            )
            send_telegram_message(token, chat_id, status_msg)
            continue

        # Si el usuario envió un archivo PDF
        if doc:
            file_name = doc.get("file_name", "puestos_ofertados.pdf")
            mime_type = doc.get("mime_type", "")
            file_id = doc.get("file_id")

            if file_name.lower().endswith(".pdf") or "pdf" in mime_type.lower():
                # Comprobar si por error enviaron el PDF de adjudicaciones en vez de puestos
                if "lis_mae" in file_name.lower() or "adjudic" in file_name.lower():
                    warn_msg = (
                        "⚠️ <b>Archivo no compatible con Destinos:</b>\n"
                        f"Has enviado <code>{file_name}</code>, que corresponde a la lista de adjudicaciones de interinos.\n\n"
                        "• Para actualizar la Bolsa, envíalo a tu bot de la bolsa (@Bolsa_actuali_bot).\n"
                        "• En este bot de Destinos debes enviar el PDF de <b>puestos ofertados</b> (habitualmente <code>*_pue_prov.pdf</code>)."
                    )
                    send_telegram_message(token, chat_id, warn_msg)
                    continue

                print(f"[!] PDF recibido desde Telegram: {file_name} (ID: {file_id})")
                send_telegram_message(
                    token, chat_id,
                    f"⏳ <b>PDF recibido:</b> <code>{file_name}</code>\n"
                    f"Iniciando descarga y cálculo de distancias y destinos docentes..."
                )

                # 1. Obtener ruta del archivo en Telegram
                file_info_url = f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}"
                try:
                    with urllib.request.urlopen(file_info_url, timeout=15) as fi_resp:
                        fi_data = json.loads(fi_resp.read().decode("utf-8"))
                        file_path = fi_data["result"]["file_path"]
                        download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
                except Exception as e:
                    send_telegram_message(token, chat_id, f"❌ Error al obtener ruta del archivo: {e}")
                    continue

                # 2. Descargar PDF localmente
                local_pdf = os.path.join(os.getcwd(), f"telegram_{file_name}")
                try:
                    with urllib.request.urlopen(download_url, timeout=45) as dl_resp, open(local_pdf, "wb") as f_out:
                        f_out.write(dl_resp.read())
                    print(f"[OK] Archivo descargado con éxito: {local_pdf}")
                except Exception as e:
                    send_telegram_message(token, chat_id, f"❌ Error al descargar el PDF desde Telegram: {e}")
                    continue

                # 3. Ejecutar actualización completa
                try:
                    sys.argv = ["actualizar_puestos.py", local_pdf]
                    run_actualizacion()
                    
                    # Leer estadísticas
                    stats_file = "data/stats_summary.json"
                    fecha = "Reciente"
                    total_plazas = 0
                    vacantes = 0
                    indet = 0
                    det = 0
                    itin = 0
                    if os.path.exists(stats_file):
                        with open(stats_file, "r", encoding="utf-8") as sf:
                            stats = json.load(sf)
                            fecha = stats.get("fecha_adjudicacion", fecha)
                            total_plazas = stats.get("total_plazas", 0)
                            vacantes = stats.get("total_vacantes", 0)
                            indet = stats.get("total_sustituciones_indet", 0)
                            det = stats.get("total_sustituciones_det", 0)
                            itin = stats.get("total_itinerantes", 0)

                    # Subir a repositorio GitHub
                    push_to_github(commit_msg=f"Telegram Bot: Actualización de puestos ({fecha})")

                    success_msg = (
                        f"✅ <b>¡Web de Destinos Docentes actualizada con éxito!</b>\n\n"
                        f"📅 <b>Convocatoria:</b> {fecha}\n"
                        f"🏫 <b>Total Plazas:</b> {total_plazas:,}\n"
                        f"🟢 <b>Vacantes:</b> {vacantes:,}\n"
                        f"🔵 <b>Sust. Indeterminadas:</b> {indet:,}\n"
                        f"🟠 <b>Sust. Determinadas:</b> {det:,}\n"
                        f"🚗 <b>Plazas Itinerantes:</b> {itin:,}\n\n"
                        f"🌐 <b>Ver web online:</b>\n"
                        f"{web_url}"
                    )
                    send_telegram_message(token, chat_id, success_msg)
                    new_pdf_processed = True
                except Exception as e:
                    send_telegram_message(token, chat_id, f"❌ Error al procesar los datos de puestos ofertados: {e}")

    # Guardar nuevo offset para no repetir mensajes
    with open(offset_file, "w") as f:
        f.write(str(offset))

    # Confirmar a los servidores de Telegram que estos mensajes ya han sido procesados
    if offset > 0:
        try:
            ack_url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset + 1}&limit=1"
            with urllib.request.urlopen(ack_url, timeout=10) as ack_resp:
                pass
        except Exception:
            pass

    return new_pdf_processed

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--notify":
        # Enviar notificación informativa
        msg = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Actualización completada."
        cfg = get_telegram_config()
        send_telegram_message(cfg["token"], cfg["chat_id"], msg)
    else:
        check_telegram_updates()
