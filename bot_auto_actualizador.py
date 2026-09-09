"""
bot_auto_actualizador.py
Bot autónomo que comprueba las fuentes oficiales de Conselleria d'Educació GVA
para detectar si se ha publicado una nueva relación de puestos ofertados (PDF *_pue_prov.pdf).
Si detecta un nuevo archivo, lo descarga y ejecuta la actualización automáticamente.
"""
import os
import sys
import re
import urllib.request
import urllib.error
from actualizar_puestos import main as run_actualizacion, download_pdf_if_url

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

SOURCES_TO_CHECK = [
    {
        "name": "Convocatoria y Petición Telemática (Castellano)",
        "url": "https://ceice.gva.es/es/web/rrhh-educacion/convocatoria-y-peticion-telematica",
        "patterns": [
            r'href="([^"]*pue_prov[^"]*\.pdf)"',
            r'href="([^"]*llocs_oferits[^"]*\.pdf)"'
        ]
    },
    {
        "name": "Convocatòria i Petició Telemàtica (Valencià)",
        "url": "https://ceice.gva.es/ca/web/rrhh-educacion/convocatoria-y-peticion-telematica",
        "patterns": [
            r'href="([^"]*pue_prov[^"]*\.pdf)"',
            r'href="([^"]*llocs_oferits[^"]*\.pdf)"'
        ]
    }
]

LAST_PDF_FILE = "data/last_processed_pdf.txt"

def get_last_processed_info():
    if os.path.exists(LAST_PDF_FILE):
        try:
            with open(LAST_PDF_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            return ""
    return ""

def save_last_processed_info(info):
    os.makedirs(os.path.dirname(LAST_PDF_FILE), exist_ok=True)
    with open(LAST_PDF_FILE, "w", encoding="utf-8") as f:
        f.write(info)

def extract_date_key_from_url(url):
    # Formato habitual GVA: YYMMDD_pue_prov.pdf (ej: 260908 -> 260908)
    m = re.search(r'(\d{6})_pue_prov', url, re.IGNORECASE)
    if m:
        return m.group(1)
    # Formato alternativo con fecha
    m2 = re.search(r'(\d{2})(\d{2})(\d{2})', url)
    if m2:
        return m2.group(0)
    return "000000"

def search_for_new_pdf():
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    candidates = []

    for src in SOURCES_TO_CHECK:
        try:
            req = urllib.request.Request(src["url"], headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
                for pat in src["patterns"]:
                    matches = re.findall(pat, html, re.IGNORECASE)
                    for m in matches:
                        if m.startswith("/"):
                            m = "https://ceice.gva.es" + m
                        candidates.append((src["name"], m))
        except Exception:
            continue

    if not candidates:
        return None

    # Eliminar duplicados manteniendo orden
    unique_candidates = []
    seen = set()
    for src_name, url in candidates:
        if url not in seen:
            seen.add(url)
            unique_candidates.append((src_name, url))

    # Ordenar por fecha en el nombre de archivo descendente para elegir el más reciente
    unique_candidates.sort(key=lambda item: extract_date_key_from_url(item[1]), reverse=True)
    return unique_candidates

def check_and_update():
    print("=" * 64)
    print(" 🤖 BOT AUTÓNOMO DE PUESTOS OFERTADOS - CONSELLERIA GVA")
    print("=" * 64)

    last_pdf = get_last_processed_info()
    print(f"[*] Último archivo registrado: {last_pdf or 'Ninguno'}")
    print("[*] Rastreando fuentes oficiales de Conselleria...")

    candidates = search_for_new_pdf()
    if not candidates:
        print("[i] No se han detectado enlaces de puestos en esta pasada.")
        return False

    # Tomar el más reciente
    src_name, newest_url = candidates[0]
    date_key = extract_date_key_from_url(newest_url)
    print(f"[*] Listado más reciente encontrado ({date_key}) en {src_name}:\n    {newest_url}")

    if newest_url == last_pdf:
        print("[i] Este listado ya está procesado y la web está al día. No se requieren cambios.")
        return False

    print(f"[!] ¡NUEVO LISTADO DETECTADO! Descargando y actualizando...")
    try:
        local_pdf = download_pdf_if_url(newest_url)
        sys.argv = ["actualizar_puestos.py", local_pdf]
        run_actualizacion()
        save_last_processed_info(newest_url)
        print("[OK] ¡Actualización completada con éxito!")
        push_to_github()
        return True
    except Exception as e:
        print(f"[-] Error al procesar {newest_url}: {e}")
        return False

def push_to_github():
    print("[*] Publicando cambios automáticamente en GitHub Pages...")
    import subprocess
    git_cmd = os.path.join(os.path.dirname(__file__), "tools", "git", "cmd", "git.exe")
    if not os.path.exists(git_cmd):
        git_cmd = "git"
    
    try:
        # Actualizar cache busters en index.html
        index_path = os.path.join(os.path.dirname(__file__), "index.html")
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                content = f.read()
            import time
            v = str(int(time.time()))
            content = re.sub(r'data/puestos_data\.js\?v=\w+', f'data/puestos_data.js?v={v}', content)
            content = re.sub(r'data/stats_summary\.js\?v=\w+', f'data/stats_summary.js?v={v}', content)
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(content)

        subprocess.run([git_cmd, "config", "user.name", "github-actions[bot]"], check=False)
        subprocess.run([git_cmd, "config", "user.email", "github-actions[bot]@users.noreply.github.com"], check=False)
        subprocess.run([git_cmd, "add", "index.html", "data/"], check=True)
        subprocess.run([git_cmd, "commit", "-m", "Auto-update: Nuevos puestos publicados por Conselleria GVA"], check=True)
        subprocess.run([git_cmd, "push", "origin", "main"], check=True)
        print("[OK] ¡Cambios subidos a GitHub con éxito! Estará visible online en ~60 segundos.")
        return True
    except Exception as e:
        print(f"[-] Error al subir a GitHub: {e}")
        return False

if __name__ == "__main__":
    import time
    if "--continuous" in sys.argv:
        duration_minutes = 15
        print(f"[*] Modo continuo activado: supervisando la web de Conselleria cada 60 segundos...")
        start_time = time.time()
        updated = False
        while time.time() - start_time < duration_minutes * 60:
            if check_and_update():
                updated = True
                break
            print("[*] Esperando 60 segundos antes de la siguiente comprobación...")
            time.sleep(60)
        if not updated:
            print("[i] Fin del ciclo de supervisión continua sin novedades.")
    else:
        check_and_update()
