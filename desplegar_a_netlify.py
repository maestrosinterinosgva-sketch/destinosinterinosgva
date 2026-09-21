"""
desplegar_a_netlify.py
Permite subir automáticamente 'destinos_web.zip' a tu web de Netlify mediante su API oficial.
"""
import os
import sys
import json
import urllib.request
import urllib.error

CONFIG_FILE = "netlify_config.json"

def get_netlify_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None

def deploy_zip_to_netlify(zip_path="destinos_web.zip"):
    config = get_netlify_config()
    if not config or not config.get("site_id") or not config.get("auth_token"):
        print("[-] Falta configurar netlify_config.json con tu site_id y auth_token de Netlify.")
        return False

    site_id = config["site_id"]
    auth_token = config["auth_token"]

    if not os.path.exists(zip_path):
        print(f"[-] No se encuentra el archivo {zip_path}")
        return False

    print(f"[*] Subiendo {zip_path} a Netlify (Sitio: {site_id})...")
    url = f"https://api.netlify.com/api/v1/sites/{site_id}/deploys"

    with open(zip_path, "rb") as f:
        zip_data = f.read()

    req = urllib.request.Request(
        url,
        data=zip_data,
        headers={
            "Content-Type": "application/zip",
            "Authorization": f"Bearer {auth_token}",
            "User-Agent": "Destinos-Deployer/1.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            deploy_url = result.get("ssl_url") or result.get("url")
            print("=" * 60)
            print(" 🎉 ¡WEB ACTUALIZADA EN NETLIFY CON ÉXITO!")
            print(f" 🌐 URL PÚBLICA: {deploy_url}")
            print("=" * 60)
            return True
    except urllib.error.HTTPError as e:
        print(f"[-] Error HTTP al desplegar en Netlify: {e.code} - {e.read().decode('utf-8')}")
        return False
    except Exception as e:
        print(f"[-] Error de conexión: {e}")
        return False

if __name__ == "__main__":
    deploy_zip_to_netlify()
